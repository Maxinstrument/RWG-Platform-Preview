/* ============================================================
   RWG Platform — Scorecard data layer (Firestore-backed)

   Same shape as data.js: an in-memory cache kept live by real-time
   listeners, optimistic local writes, then async persist. This is the
   only file that knows where scorecard data lives.

   Collections (all NEW — they do not exist in the live CRM, so nothing
   here can affect leads/users/reports):
     cases/{recordId}          one opportunity. Team-readable.
     weeks/{agentUid_weekEnding} one agent's weekly submission.
     config/agents             legacy-name -> account map + goals.

   Dormant until a module calls init(). The kernel does not auto-start
   it, so the platform runs fine before the Firestore rules are published.

   Money and lifecycle rules live in scorecard-config.js (RWG.scorecard).
   This file only reads/writes; it never invents a money rule.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.scorecardData = (function () {
  const S = () => RWG.scorecard;
  const db = () => RWG.fb && RWG.fb.db;
  const nowISO = () => new Date().toISOString();

  let _seq = 0;
  const newRecordId = () =>
    (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'case_' + Date.now().toString(36) + (++_seq);

  const CASE_FIELDS = ['recordId', 'agentUid', 'agentName', 'clientName', 'product', 'source',
    'state', 'amount', 'aum', 'coCreditUids', 'coCreditNames',
    'openedWeek', 'submittedAt', 'closedAt', 'createdAt', 'createdBy', 'updatedAt',
    // the spine + granular pipeline (phase 2)
    // contactId is who the opportunity is FOR — a person, not a family.
    // householdId rides along for the family screens, but the contact is
    // what tasks, notes and the activity feed hang off.
    'contactId', 'householdId', 'stageId', 'stageAt', 'lostReason', 'pendingClose',
    // money detail + the close (phase 2, slice 2)
    'rate', 'premiumAnnual', 'benefit', 'renewalAnnual', 'applied',
    'pendingCloseAt', 'closeNote', 'a360Recorded', 'lostBy', 'lostAt'];

  // Passed through buildCase untouched (null when absent), so no edit
  // modal anywhere can silently strip them.
  const PASSTHROUGH = ['contactId', 'householdId', 'stageId', 'stageAt', 'lostReason', 'rate', 'premiumAnnual',
    'benefit', 'renewalAnnual', 'applied', 'pendingCloseAt', 'closeNote',
    'a360Recorded', 'lostBy', 'lostAt', 'lostFromStage',
    'title', 'sourceNote', 'details'];   // the opportunity window (phase 5.6)

  const cache = { cases: [], weeks: [], agents: {} };
  let onChange = () => {};
  let me = null;
  let unsubs = [];
  let started = false;

  function init(profile, cb) {
    me = profile;
    onChange = cb || (() => {});
    if (!db()) { console.warn('scorecardData.init: Firebase not ready'); return; }
    teardown();
    started = true;

    // Money follows the case rate, then the (possibly overridden) default —
    // wake the rates listener wherever the cases wake. Idempotent.
    if (RWG.scorecard && RWG.scorecard.initRates) RWG.scorecard.initRates();

    // Cases: the whole team (client names visible to all, per the current model).
    unsubs.push(db().collection('cases').onSnapshot(
      s => { cache.cases = s.docs.map(d => Object.assign({ recordId: d.id }, d.data())); onChange(); },
      e => console.error('cases listener:', e && e.message)));

    // Weekly submissions: aggregate production, team-readable.
    unsubs.push(db().collection('weeks').onSnapshot(
      s => { cache.weeks = s.docs.map(d => Object.assign({ id: d.id }, d.data())); onChange(); },
      e => console.error('weeks listener:', e && e.message)));

    // Legacy-name -> account map + per-agent goals.
    unsubs.push(db().collection('config').doc('agents').onSnapshot(
      d => { cache.agents = (d.exists && d.data()) || {}; onChange(); },
      e => console.error('agents config listener:', e && e.message)));
  }
  function teardown() {
    unsubs.forEach(u => { try { u(); } catch (e) {} });
    unsubs = []; started = false;
    cache.cases = []; cache.weeks = [];
  }
  const isStarted = () => started;

  // ── reads (synchronous, from the live cache) ──
  const cases = () => cache.cases.slice();
  // Rate-aware since phase 2: deriveCase honors a per-case rate/premium and
  // falls back to the product defaults, which reproduce the old numbers exactly.
  const withMoney = (c) => Object.assign({}, c,
    (S().deriveCase ? S().deriveCase(c) : S().derive(c.product, c.amount, c.aum)),
    S().deriveWeeks(c));
  const casesWithMoney = () => cache.cases.map(withMoney);
  function casesForAgent(uid) {
    return cache.cases.filter(c => c.agentUid === uid || (c.coCreditUids || []).indexOf(uid) >= 0);
  }
  const caseById = (id) => cache.cases.find(c => c.recordId === id) || null;

  const weekId = (uid, weekEnding) => uid + '_' + weekEnding;
  const weeks = () => cache.weeks.slice();
  const weekFor = (uid, weekEnding) => cache.weeks.find(w => w.id === weekId(uid, weekEnding)) || null;
  const weeksForWeek = (weekEnding) => cache.weeks.filter(w => w.weekEnding === weekEnding);

  const agentsConfig = () => Object.assign({}, cache.agents);
  const agentConfig = (uid) => cache.agents[uid] || null;

  // ── case writes ──
  // Build the stored row. openedWeek is immutable; submittedAt/closedAt are
  // write-once (only ever added, never cleared) so each week's history is
  // permanent and the Firestore rules accept the update. Admin corrections
  // that need to move a stamp go through adminSetStamps().
  function buildCase(input, existing) {
    existing = existing || {};
    const state = input.state || existing.state || 'Opened';
    const product = input.product != null ? input.product : (existing.product || '');
    const amountIn = input.amount != null ? input.amount : existing.amount;
    const aumIn = input.aum != null ? input.aum : existing.aum;
    const m = S().normalizeMoney(product, amountIn, aumIn);   // form can never set both fields

    const openedWeek = existing.openedWeek || input.openedWeek || S().currentWeekEnding();
    let submittedAt = existing.submittedAt || null;
    let closedAt = existing.closedAt || null;
    if (!submittedAt && (state === 'Submitted' || state === 'Closed')) submittedAt = nowISO();
    if (!closedAt && state === 'Closed') closedAt = nowISO();

    const out = {
      recordId: existing.recordId || input.recordId || newRecordId(),
      agentUid: existing.agentUid || input.agentUid || null,
      agentName: input.agentName != null ? input.agentName : (existing.agentName || ''),
      clientName: input.clientName != null ? input.clientName : (existing.clientName || ''),
      product: product,
      source: input.source != null ? input.source : (existing.source || ''),
      state: state,
      amount: m.amount,
      aum: m.aum,
      coCreditUids: input.coCreditUids || existing.coCreditUids || [],
      coCreditNames: input.coCreditNames || existing.coCreditNames || [],
      pendingClose: input.pendingClose !== undefined ? !!input.pendingClose : !!existing.pendingClose,
      openedWeek: openedWeek,
      submittedAt: submittedAt,
      closedAt: closedAt,
      createdAt: existing.createdAt || nowISO(),
      createdBy: existing.createdBy || input.createdBy || (me && me.id) || null,
      updatedAt: nowISO()
    };
    PASSTHROUGH.forEach(k => {
      out[k] = input[k] !== undefined ? input[k] : (existing[k] !== undefined ? existing[k] : null);
    });
    return out;
  }

  function saveCase(input) {
    const existing = input.recordId ? caseById(input.recordId) : null;
    const row = buildCase(input, existing);
    if (!row.agentUid) return Promise.reject(new Error('a case needs an agentUid'));
    // optimistic local update
    const i = cache.cases.findIndex(c => c.recordId === row.recordId);
    if (i >= 0) cache.cases[i] = row; else cache.cases.push(row);
    onChange();
    // Resolves the saved row: a caller creating a case needs the minted
    // recordId (the opportunity window stamps a chosen starting stage).
    return db().collection('cases').doc(row.recordId).set(row)
      .then(() => row)
      .catch(e => { console.error('save case:', e && e.message); throw e; });
  }

  // Advance/change a case's state, stamping the lifecycle as needed.
  function setCaseState(recordId, state) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found: ' + recordId));
    return saveCase(Object.assign({}, existing, { state: state }));
  }

  // ── granular pipeline moves (phase 2) ─────────────────────
  // Move a case to a stage on its track. Entering a Submitted-bucket
  // stage stamps submittedAt exactly once — the same write-once stamp
  // the weekly numbers already run on. Moving backward never clears a
  // stamp (the rules would refuse anyway), so history is safe from a
  // mis-drag. Won is NOT reachable here: closing goes through the
  // close review, which is the only writer of closedAt.
  function setPipelineStage(recordId, stageId) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found: ' + recordId));
    const P = RWG.pipelines;
    const bucket = P.bucketOf(existing.product, stageId);
    if (!bucket) return Promise.reject(new Error('no such stage on this track: ' + stageId));
    // The Closed bucket has stages of its own now (Delivery Requirements →
    // Close/Won). A case that is already through the close review — or at
    // its door — may park between them; that is bookkeeping, not closing,
    // and touches no stamp. An open case still cannot close itself here.
    const through = !!(existing.closedAt || existing.pendingClose);
    if (bucket === 'Closed' && !through)
      return Promise.reject(new Error('closing goes through the close review'));
    if (through && bucket !== 'Closed')
      return Promise.reject(new Error('closed business moves only between its closed stages'));

    // stageAt: when this case landed in the stage it is in now. updatedAt
    // moves for any edit, so it cannot answer "how long has this been
    // sitting here" — which is the whole question at a Monday meeting.
    const row = Object.assign({}, existing, { stageId: stageId, stageAt: nowISO(), updatedAt: nowISO() });
    if (bucket === 'Submitted' && !row.submittedAt) row.submittedAt = nowISO();
    if (bucket === 'Submitted' && row.state === 'Opened') row.state = 'Submitted';
    if (bucket === 'Lost') { row.state = 'Lost'; }

    const i = cache.cases.findIndex(c => c.recordId === recordId);
    if (i >= 0) cache.cases[i] = row;
    onChange();
    return db().collection('cases').doc(recordId).set(row)
      .catch(e => { console.error('set pipeline stage:', e && e.message); throw e; });
  }

  // Mark a case lost, always with a reason — the only honest signal
  // about why business does not close. Stamped with who and when, so
  // advisor-marked losses surface in the partner inbox.
  function markLost(recordId, reason, note) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found: ' + recordId));
    const row = Object.assign({}, existing, {
      // Remember the stage it died on — the funnel reads this to show
      // WHERE business leaks, which 'lost' alone can never say.
      lostFromStage: existing.stageId || existing.lostFromStage || null,
      stageId: 'lost', state: 'Lost', pendingClose: false,
      lostReason: (reason || 'Other') + (note ? ' — ' + note : ''),
      lostBy: (me && me.id) || null, lostAt: nowISO(),
      updatedAt: nowISO()
    });
    const i = cache.cases.findIndex(c => c.recordId === recordId);
    if (i >= 0) cache.cases[i] = row;
    onChange();
    return db().collection('cases').doc(recordId).set(row)
      .catch(e => { console.error('mark lost:', e && e.message); throw e; });
  }

  // ── the close (phase 2, slice 2) ──────────────────────────
  // An advisor pushes a case to Won; it moves on the board but does NOT
  // count — no stamp is written. A partner's confirmation is the only
  // writer of closedAt.
  function pushWon(recordId) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found: ' + recordId));
    if (existing.closedAt) return Promise.reject(new Error('already closed'));
    // Land at the track's first Closed stage: Delivery Requirements where
    // the track has it, Won where it does not. The receipt chase starts the
    // moment the business is pushed, not after someone remembers to move it.
    const pl = RWG.pipelines.pipelineForProduct(existing.product);
    const firstClosed = pl.stages.find(s => s.bucket === 'Closed');
    const row = Object.assign({}, existing, {
      stageId: firstClosed ? firstClosed.id : 'won', pendingClose: true,
      pendingCloseAt: existing.pendingCloseAt || nowISO(),
      updatedAt: nowISO()
    });
    const i = cache.cases.findIndex(c => c.recordId === recordId);
    if (i >= 0) cache.cases[i] = row;
    onChange();
    return db().collection('cases').doc(recordId).set(row)
      .catch(e => { console.error('push won:', e && e.message); throw e; });
  }

  // Partner-only (rules enforce it): confirm the close. Snapshots the
  // applied-for money once, writes the finals, and stamps closedAt into
  // the chosen week — defaulting to when the advisor pushed it, so a
  // Friday push verified on Monday still lands in the week it was won.
  // fin: { amount|aum, rate, premiumAnnual, benefit, renewalAnnual,
  //        closedWeek ('yyyy-mm-dd' Friday), a360 (bool), note }
  function confirmClose(recordId, fin) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found: ' + recordId));
    fin = fin || {};
    const row = Object.assign({}, existing);
    if (!row.applied) {
      row.applied = {
        amount: existing.amount || 0, aum: existing.aum || 0,
        rate: existing.rate != null ? existing.rate : null,
        premiumAnnual: existing.premiumAnnual != null ? existing.premiumAnnual : null
      };
    }
    ['amount', 'aum', 'rate', 'premiumAnnual', 'benefit', 'renewalAnnual'].forEach(k => {
      if (fin[k] !== undefined) row[k] = fin[k];
    });
    // closedAt is write-once: confirming an already-closed case never moves its week.
    row.closedAt = existing.closedAt ||
      (fin.closedWeek ? fin.closedWeek + 'T12:00:00.000-05:00' : nowISO());
    if (!row.submittedAt) row.submittedAt = row.closedAt;
    row.state = 'Closed'; row.pendingClose = false;
    // Keep its closed stage: a confirmed close still waiting on the delivery
    // receipt stays in Delivery Requirements rather than teleporting to Won.
    if (RWG.pipelines.bucketOf(existing.product, existing.stageId) !== 'Closed') row.stageId = 'won';
    row.closeNote = fin.note || row.closeNote || null;
    if (fin.a360) row.a360Recorded = { by: (me && me.id) || null, at: nowISO() };
    row.updatedAt = nowISO();
    const i = cache.cases.findIndex(c => c.recordId === recordId);
    if (i >= 0) cache.cases[i] = row;
    onChange();
    return db().collection('cases').doc(recordId).set(row)
      .catch(e => { console.error('confirm close:', e && e.message); throw e; });
  }

  // Not ready after all: back to the last working stage of its track,
  // pending flag off. The partner talks to the advisor; the case waits
  // where the work actually is.
  function sendBack(recordId) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found: ' + recordId));
    const pl = RWG.pipelines.pipelineForProduct(existing.product);
    const sub = pl.stages.filter(s => s.bucket === 'Submitted');
    const backTo = sub.length ? sub[sub.length - 1].id : pl.stages[0].id;
    const row = Object.assign({}, existing, {
      stageId: backTo, pendingClose: false, updatedAt: nowISO()
    });
    const i = cache.cases.findIndex(c => c.recordId === recordId);
    if (i >= 0) cache.cases[i] = row;
    onChange();
    return db().collection('cases').doc(recordId).set(row)
      .catch(e => { console.error('send back:', e && e.message); throw e; });
  }

  function deleteCase(recordId) {
    const c = caseById(recordId);
    cache.cases = cache.cases.filter(x => x.recordId !== recordId);
    onChange();
    if (c && RWG.trash) {
      return RWG.trash.send('cases', recordId, c, c.title || c.clientName || '(unnamed case)');
    }
    return db().collection('cases').doc(recordId).delete()
      .catch(e => { console.error('delete case:', e && e.message); throw e; });
  }

  // Admin-only: correct which week each milestone lands in (the old "Correct the
  // weeks" tool). Writes the stamps directly at noon Eastern of each Friday so
  // deriveWeeks() reproduces them. Firestore rules allow admins to move stamps.
  function adminSetStamps(recordId, weeksObj) {
    const existing = caseById(recordId);
    if (!existing) return Promise.reject(new Error('case not found'));
    const toStamp = (fri) => fri ? (fri + 'T12:00:00.000-05:00') : null;
    const row = Object.assign({}, existing, { updatedAt: nowISO() });
    if (weeksObj.openedWeek != null) row.openedWeek = weeksObj.openedWeek;
    if (weeksObj.submittedWeek != null) row.submittedAt = toStamp(weeksObj.submittedWeek);
    if (weeksObj.closedWeek != null) row.closedAt = toStamp(weeksObj.closedWeek);
    // state follows the furthest stamp that still exists
    row.state = row.closedAt ? 'Closed' : (row.submittedAt ? 'Submitted' : 'Opened');
    const i = cache.cases.findIndex(c => c.recordId === recordId);
    if (i >= 0) cache.cases[i] = row;
    onChange();
    return db().collection('cases').doc(recordId).set(row)
      .catch(e => { console.error('admin set stamps:', e && e.message); throw e; });
  }

  // ── weekly submission writes ──
  // Upsert one doc per agent per week (deterministic id = idempotent).
  function saveWeek(doc) {
    if (!doc.agentUid || !doc.weekEnding) return Promise.reject(new Error('a week needs agentUid and weekEnding'));
    const id = weekId(doc.agentUid, doc.weekEnding);
    const row = Object.assign({}, doc, { id: id, updatedAt: nowISO() });
    const i = cache.weeks.findIndex(w => w.id === id);
    if (i >= 0) cache.weeks[i] = row; else cache.weeks.push(row);
    onChange();
    const payload = Object.assign({}, row); delete payload.id;
    return db().collection('weeks').doc(id).set(payload)
      .catch(e => { console.error('save week:', e && e.message); throw e; });
  }

  // Save the daily tally (and its rolled-up activity totals) WITHOUT stamping
  // the week submitted. merge:true means logging a day never wipes a previously
  // submitted week's other fields, and re-editing a day is idempotent. The
  // scorecard writes here on every daily cell change; saveWeek() finalises.
  function saveDaily(partial) {
    if (!partial.agentUid || !partial.weekEnding) return Promise.reject(new Error('daily needs agentUid and weekEnding'));
    const id = weekId(partial.agentUid, partial.weekEnding);
    const existing = cache.weeks.find(w => w.id === id) || {};
    const row = Object.assign({}, existing, partial, { id: id, updatedAt: nowISO() });
    const i = cache.weeks.findIndex(w => w.id === id);
    if (i >= 0) cache.weeks[i] = row; else cache.weeks.push(row);
    onChange();
    const payload = Object.assign({}, row); delete payload.id;
    return db().collection('weeks').doc(id).set(payload, { merge: true })
      .catch(e => { console.error('save daily:', e && e.message); throw e; });
  }

  // ── migration import (admin): write a fully-formed doc verbatim ──
  // Unlike saveCase, this preserves the exact lifecycle stamps carried over from
  // the old Sheet (it does not re-derive them from state). Idempotent: same
  // recordId overwrites, never duplicates.
  function importCase(doc) {
    if (!doc.recordId) return Promise.reject(new Error('import needs a recordId'));
    const i = cache.cases.findIndex(c => c.recordId === doc.recordId);
    if (i >= 0) cache.cases[i] = doc; else cache.cases.push(doc);
    onChange();
    return db().collection('cases').doc(doc.recordId).set(doc)
      .catch(e => { console.error('import case:', e && e.message); throw e; });
  }
  function importWeek(doc) {
    if (!doc.agentUid || !doc.weekEnding) return Promise.reject(new Error('import week needs agentUid + weekEnding'));
    const id = weekId(doc.agentUid, doc.weekEnding);
    const row = Object.assign({ id: id }, doc);
    const i = cache.weeks.findIndex(w => w.id === id);
    if (i >= 0) cache.weeks[i] = row; else cache.weeks.push(row);
    onChange();
    const payload = Object.assign({}, doc);
    return db().collection('weeks').doc(id).set(payload)
      .catch(e => { console.error('import week:', e && e.message); throw e; });
  }

  // ── config/agents (admin: migration + settings) ──
  function saveAgentsConfig(map) {
    cache.agents = Object.assign({}, map);
    onChange();
    return db().collection('config').doc('agents').set(map)
      .catch(e => { console.error('save agents config:', e && e.message); throw e; });
  }

  return {
    init, teardown, isStarted,
    cases, casesWithMoney, casesForAgent, caseById, withMoney,
    weeks, weekFor, weeksForWeek, weekId,
    agentsConfig, agentConfig,
    buildCase, saveCase, setCaseState, setPipelineStage, markLost,
    pushWon, confirmClose, sendBack, deleteCase, adminSetStamps,
    saveWeek, saveDaily, saveAgentsConfig, importCase, importWeek,
    CASE_FIELDS, _cache: cache
  };
})();
