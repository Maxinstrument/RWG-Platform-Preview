/* ============================================================
   RWG Platform — Households + Contacts data layer (the spine)

   Same shape as data.js / scorecard-data.js: an in-memory cache
   kept live by real-time listeners, optimistic local writes, then
   async persist. This is the only file that knows where the spine
   lives.

   Collections (both NEW — nothing here can affect leads/cases/users):
     households/{id}   the account. One per client family.
     contacts/{id}     a person, always attached to one household.

   The one rule of the preview build: existing collections stay
   read-only from new code. The single exception, by design, is
   convertLead(), which stamps a lead with a pointer to the
   household it became (additive, reversible fields + one history
   entry — the same pattern the CRM itself uses).

   Dormant until a module calls init(). The kernel never starts it.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.hh = (function () {
  const db = () => RWG.fb && RWG.fb.db;
  const now = () => Date.now();

  const RELATIONSHIPS = ['Primary client', 'Spouse', 'Child', 'Parent', 'Sibling', 'Other'];
  // How two households connect. Stored one entry per side, so each
  // household's card can say what the other one is to it.
  const LINK_KINDS = [
    { id: 'family',      label: 'Family',           inverse: 'family' },
    { id: 'referred',    label: 'Referred them',    inverse: 'referred-by' },
    { id: 'referred-by', label: 'Referred by them', inverse: 'referred' },
    { id: 'business',    label: 'Business / trust', inverse: 'business' },
    { id: 'other',       label: 'Connected',        inverse: 'other' }
  ];
  const linkLabel = (id) => (LINK_KINDS.find(k => k.id === id) || {}).label || 'Connected';
  const linkInverse = (id) => (LINK_KINDS.find(k => k.id === id) || {}).inverse || 'other';

  // ── live cache ──
  const cache = { households: [], contacts: [] };
  let onChange = () => {};
  let me = null;
  let unsubs = [];
  let started = false;

  function init(profile, cb) {
    me = profile;
    onChange = cb || (() => {});
    if (!db()) { console.warn('hh.init: Firebase not ready'); return; }
    teardown();
    started = true;

    // The whole team sees the whole book — no role filter, by decision.
    unsubs.push(db().collection('households').onSnapshot(
      s => { cache.households = s.docs.map(d => Object.assign({ id: d.id }, d.data())); onChange(); },
      e => console.error('households listener:', e && e.message)));

    unsubs.push(db().collection('contacts').onSnapshot(
      s => { cache.contacts = s.docs.map(d => Object.assign({ id: d.id }, d.data())); onChange(); },
      e => console.error('contacts listener:', e && e.message)));
  }
  function teardown() {
    unsubs.forEach(u => { try { u(); } catch (e) {} });
    unsubs = []; started = false;
    cache.households = []; cache.contacts = [];
  }
  const isStarted = () => started;

  // ── reads (synchronous, from the live cache) ──
  const households = () => cache.households.slice();
  const household = (id) => cache.households.find(h => h.id === id) || null;
  const contacts = () => cache.contacts.slice();
  const contact = (id) => cache.contacts.find(c => c.id === id) || null;
  const contactsFor = (hhId) => cache.contacts.filter(c => c.householdId === hhId);
  const primaryContact = (hhId) =>
    contactsFor(hhId).find(c => c.relationship === 'Primary client') || contactsFor(hhId)[0] || null;
  const contactName = (c) => `${(c && c.firstName) || ''} ${(c && c.lastName) || ''}`.trim();

  // ── duplicate matching (same normalisation the leads import uses) ──
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const phoneKey = (p) => { const d = digits(p); return d.length >= 10 ? d.slice(-10) : (d.length >= 7 ? d : ''); };
  const emailKey = (e) => { const s = String(e == null ? '' : e).trim().toLowerCase(); return /.+@.+\..+/.test(s) ? s : ''; };
  // Someone already in the book with this phone or email (soft warn, never a block).
  function findDupContact(phone, email, ignoreId) {
    const pk = phoneKey(phone), ek = emailKey(email);
    return cache.contacts.find(c => c.id !== ignoreId &&
      ((pk && phoneKey(c.phone) === pk) || (ek && emailKey(c.email) === ek))) || null;
  }

  // ── key dates (computed, never stored — a reminder is a query) ──
  // dob is 'yyyy-mm-dd'. Returns birthdays in the next `days`, soonest first.
  function upcomingBirthdays(days) {
    const out = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    cache.contacts.forEach(c => {
      if (!c.dob || !/^\d{4}-\d{2}-\d{2}$/.test(c.dob)) return;
      const [y, m, d] = c.dob.split('-').map(Number);
      let next = new Date(today.getFullYear(), m - 1, d);
      if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
      const inDays = Math.round((next - today) / 86400000);
      if (inDays <= (days || 14)) out.push({ contact: c, date: next, turning: next.getFullYear() - y, inDays });
    });
    return out.sort((a, b) => a.inDays - b.inDays);
  }

  // ── household writes ──
  function stripId(o) { const p = Object.assign({}, o); delete p.id; return p; }
  function persistHousehold(h) {
    return db().collection('households').doc(h.id).set(stripId(h))
      .catch(e => { console.error('save household:', e && e.message); throw e; });
  }
  function persistContact(c) {
    return db().collection('contacts').doc(c.id).set(stripId(c))
      .catch(e => { console.error('save contact:', e && e.message); throw e; });
  }

  function addHousehold(fields) {
    const ref = db().collection('households').doc();
    const h = Object.assign({
      id: ref.id, name: '', advisorUid: null, advisorName: '',
      source: '', sourceDetail: '', notes: '', links: [],
      a360Complete: null,                       // {by, byName, at} once checked
      createdAt: now(), createdBy: (me && me.id) || null, updatedAt: now()
    }, fields);
    cache.households.push(h); onChange();
    persistHousehold(h);
    return h;
  }

  function saveHousehold(patch) {
    const h = household(patch.id); if (!h) return;
    Object.assign(h, patch, { updatedAt: now() });
    onChange();
    return persistHousehold(h);
  }

  function setA360(hhId, done) {
    const h = household(hhId); if (!h) return;
    h.a360Complete = done ? { by: (me && me.id) || null, byName: (me && me.name) || null, at: now() } : null;
    h.updatedAt = now();
    onChange();
    return persistHousehold(h);
  }

  function deleteHousehold(id) {   // admin only (rules) — UI guards that it holds no people
    cache.households = cache.households.filter(h => h.id !== id);
    onChange();
    return db().collection('households').doc(id).delete()
      .catch(e => { console.error('delete household:', e && e.message); throw e; });
  }

  // ── contact writes ──
  function addContact(fields) {
    const ref = db().collection('contacts').doc();
    const c = Object.assign({
      id: ref.id, householdId: null, firstName: '', lastName: '',
      relationship: 'Other', email: '', phone: '', dob: '', employer: '',
      planType: '', memberClass: '', yos: null, afc: null, age: null,
      leadId: null,                    // set when this person began as a lead
      advisorstream: false,            // on the newsletter list yet?
      createdAt: now(), createdBy: (me && me.id) || null, updatedAt: now()
    }, fields);
    ['yos', 'afc', 'age'].forEach(k => { c[k] = (c[k] === '' || c[k] == null) ? null : Number(c[k]); });
    cache.contacts.push(c); onChange();
    persistContact(c);
    return c;
  }

  function saveContact(patch) {
    const c = contact(patch.id); if (!c) return;
    Object.assign(c, patch, { updatedAt: now() });
    ['yos', 'afc', 'age'].forEach(k => { if (c[k] === '' || c[k] == null) c[k] = null; else c[k] = Number(c[k]); });
    onChange();
    return persistContact(c);
  }

  function setAdvisorstream(contactId, on) {
    const c = contact(contactId); if (!c) return;
    c.advisorstream = !!on; c.updatedAt = now();
    onChange();
    return persistContact(c);
  }

  function removeContact(id) {     // admin only (rules)
    cache.contacts = cache.contacts.filter(c => c.id !== id);
    onChange();
    return db().collection('contacts').doc(id).delete()
      .catch(e => { console.error('delete contact:', e && e.message); throw e; });
  }

  // ── linking two households (one batch, both sides) ──
  function linkHouseholds(aId, bId, kind, note) {
    const a = household(aId), b = household(bId);
    if (!a || !b || aId === bId) return Promise.reject(new Error('need two different households'));
    a.links = (a.links || []).filter(l => l.householdId !== bId);
    b.links = (b.links || []).filter(l => l.householdId !== aId);
    a.links.push({ householdId: bId, kind: kind, note: note || '' });
    b.links.push({ householdId: aId, kind: linkInverse(kind), note: note || '' });
    a.updatedAt = now(); b.updatedAt = now();
    onChange();
    const batch = db().batch();
    batch.set(db().collection('households').doc(aId), stripId(a));
    batch.set(db().collection('households').doc(bId), stripId(b));
    return batch.commit().catch(e => { console.error('link households:', e && e.message); throw e; });
  }
  function unlinkHouseholds(aId, bId) {
    const a = household(aId), b = household(bId);
    if (!a || !b) return;
    a.links = (a.links || []).filter(l => l.householdId !== bId);
    b.links = (b.links || []).filter(l => l.householdId !== aId);
    a.updatedAt = now(); b.updatedAt = now();
    onChange();
    const batch = db().batch();
    batch.set(db().collection('households').doc(aId), stripId(a));
    batch.set(db().collection('households').doc(bId), stripId(b));
    return batch.commit().catch(e => { console.error('unlink households:', e && e.message); throw e; });
  }

  // ── the conversion (a promotion, not a copy) ──────────────
  // Creates (or reuses) a household, creates the contact carrying
  // everything the lead already knows, and stamps the lead with the
  // pointer — one atomic batch. The lead's activity history stays on
  // the lead, permanently reachable through contact.leadId.
  //
  // opts: { householdId }            attach to an existing household, OR
  //       { name, advisorUid, advisorName, source }   create a new one
  //       + relationship (default 'Primary client')
  function convertLead(leadId, opts) {
    const l = RWG.data.lead(leadId);
    if (!l) return Promise.reject(new Error('lead not found'));
    if (l.householdId) return Promise.reject(new Error('already converted'));

    const batch = db().batch();
    const stamp = now();
    const by = (me && me.id) || null;

    // 1 · the household
    let hh;
    if (opts.householdId) {
      hh = household(opts.householdId);
      if (!hh) return Promise.reject(new Error('household not found'));
    } else {
      const ref = db().collection('households').doc();
      hh = {
        id: ref.id,
        name: opts.name || (`${l.lastName || l.firstName || 'New'} Household`).trim(),
        advisorUid: opts.advisorUid || l.assignedTo || by,
        advisorName: opts.advisorName || '',
        source: opts.source || l.listName || l.source || '',
        sourceDetail: '', notes: '', links: [], a360Complete: null,
        createdAt: stamp, createdBy: by, updatedAt: stamp
      };
      cache.households.push(hh);
      batch.set(db().collection('households').doc(hh.id), stripId(hh));
    }

    // 2 · the person, carrying everything the lead already knows
    const cRef = db().collection('contacts').doc();
    const person = {
      id: cRef.id, householdId: hh.id,
      firstName: l.firstName || '', lastName: l.lastName || '',
      relationship: opts.relationship || 'Primary client',
      email: l.email || '', phone: l.phone || '', dob: '',
      employer: l.employer || '', planType: l.planType || '',
      memberClass: l.memberClass || '', yos: l.yos != null ? l.yos : null,
      afc: l.afc != null ? l.afc : null, age: l.age != null ? l.age : null,
      leadId: l.id, advisorstream: false,
      createdAt: stamp, createdBy: by, updatedAt: stamp
    };
    cache.contacts.push(person);
    batch.set(cRef, stripId(person));

    // 3 · stamp the lead (additive + one history entry, arrayUnion so a
    //     concurrent full-doc save can't drop it)
    const leadPatch = {
      householdId: hh.id, contactId: person.id,
      convertedAt: stamp, convertedBy: by
    };
    // Converting IS the graduation — same transition the ✦ button makes.
    if (['New', 'Attempting', 'Reached', 'Appointment Set', 'Appointment Kept'].indexOf(l.stage) >= 0) {
      leadPatch.stage = 'Opportunity Opened';
    }
    const hist = {
      id: 'h_' + stamp.toString(36), by: by, at: stamp, changes: [],
      note: '✦ Converted to household "' + hh.name + '" — client record created'
    };
    batch.update(db().collection('leads').doc(l.id),
      Object.assign({}, leadPatch, { history: firebase.firestore.FieldValue.arrayUnion(hist) }));

    onChange();
    return batch.commit()
      .then(() => ({ householdId: hh.id, contactId: person.id }))
      .catch(e => { console.error('convert lead:', e && e.message); throw e; });
  }

  return {
    RELATIONSHIPS, LINK_KINDS, linkLabel,
    init, teardown, isStarted,
    households, household, contacts, contact, contactsFor, primaryContact, contactName,
    findDupContact, upcomingBirthdays,
    addHousehold, saveHousehold, setA360, deleteHousehold,
    addContact, saveContact, setAdvisorstream, removeContact,
    linkHouseholds, unlinkHouseholds,
    convertLead,
    _cache: cache
  };
})();
