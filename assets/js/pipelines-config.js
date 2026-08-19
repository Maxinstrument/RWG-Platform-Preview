/* ============================================================
   RWG Platform — Pipelines (the three tracks, stored as data)

   The stage lists Carlos settled in the blueprint, expressed as
   configuration so the phase-3 settings editor can change them
   without a build. Until an owner saves an edited copy to
   Firestore (config/pipelines), the built-in defaults below apply
   — either way the rest of the app only ever asks this file.

   The contract that keeps the money safe:
     every stage declares `bucket` — Opened | Submitted | Closed |
     Lost — and the scorecard keeps counting the write-once stamps
     exactly as before. A granular stage is the team's view; the
     bucket is the report's. Renaming or adding stages can never
     move a historical number.

   Legacy cases have no stageId; stageForCase() maps them to the
   first stage of their bucket at read time, so no migration write
   is needed and the team drags them to the truth over time.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.pipelines = (function () {

  // The shared front end every opportunity walks first.
  const FRONT = [
    { id: 'uncovered',  label: 'Uncovered',              bucket: 'Opened' },
    // The needs we have committed to work. Uncovering a need and deciding
    // to chase it are two different moments, and the second one is the
    // week's real to-do list.
    { id: 'hit-list',   label: 'Hit List',               bucket: 'Opened' },
    { id: 'pres-sched', label: 'Presentation Scheduled', bucket: 'Opened' },
    { id: 'pres-ran',   label: 'Presentation Ran',       bucket: 'Opened' }
  ];
  const TAIL = [
    { id: 'won',  label: 'Close / Won', bucket: 'Closed' },
    { id: 'lost', label: 'Lost',        bucket: 'Lost' }
  ];

  const DEFAULTS = {
    version: 1,
    lostReasons: ['Price', 'Declined by underwriting', 'Went quiet', 'Timing', 'No longer suitable', 'Other'],
    pipelines: [
      {
        id: 'insurance', name: 'Insurance', products: ['wl', 'term', 'di', 'ltc'],
        stages: FRONT.concat([
          { id: 'application',     label: 'Application',                   bucket: 'Submitted' },
          { id: 'waiting-sig',     label: 'Waiting on Signature',          bucket: 'Submitted' },
          { id: 'medical-uw',      label: 'Medical Underwriting',          bucket: 'Submitted' },
          { id: 'approval',        label: 'Approval',                      bucket: 'Submitted' },
          { id: 'closing-pres',    label: 'Closing Presentation Scheduled', bucket: 'Submitted' },
          { id: 'funding',         label: 'Funding',                       bucket: 'Submitted' },
          // Post-close paperwork: the business is paid and counted, the
          // client still owes a delivery-receipt signature. Closed bucket,
          // so a case here IS closed on the scorecard — the stage only says
          // the file is not finished.
          { id: 'delivery-signed', label: 'Delivery Requirements',         bucket: 'Closed' }
        ], TAIL)
      },
      {
        id: 'investments', name: 'Investments', products: ['annuity', 'inv'],
        stages: FRONT.concat([
          { id: 'application',     label: 'Application',                  bucket: 'Submitted' },
          { id: 'waiting-sig',     label: 'Waiting on Signature',         bucket: 'Submitted' },
          { id: 'financial-uw',    label: 'Financial Underwriting',       bucket: 'Submitted' },
          { id: 'approval',        label: 'Approval',                     bucket: 'Submitted' },
          { id: 'funding',         label: 'Funding',                      bucket: 'Submitted' },
          { id: 'delivery-signed', label: 'Delivery Requirements',        bucket: 'Closed' }
        ], TAIL)
      },
      {
        id: 'planning', name: 'Financial Planning', products: ['plan'],
        stages: FRONT.concat([
          { id: 'gather-docs',       label: 'Gather Statements & Documents', bucket: 'Opened' },
          { id: 'engagement-letter', label: 'Engagement Letter',             bucket: 'Opened' },
          { id: 'waiting-sig-pay',   label: 'Waiting on Signature / Payment', bucket: 'Submitted' },
          { id: 'emoney',            label: 'eMoney Input',                  bucket: 'Submitted' },
          { id: 'sched-1st',         label: 'Schedule 1st Meeting',          bucket: 'Submitted' },
          { id: 'adjust-plan',       label: 'Adjust Plan',                   bucket: 'Submitted' },
          { id: 'sched-2nd',         label: 'Schedule 2nd Meeting',          bucket: 'Submitted' },
          { id: 'deliver-plan',      label: 'Deliver Final Plan',            bucket: 'Submitted' }
        ], TAIL)
      }
    ]
  };

  /* A stage that has been retired still has cases stamped with it. They
     read through to the stage that replaced it — at read time, so nothing
     is written and nothing is orphaned into the wrong column. */
  const RETIRED = { 'sched-medical': 'medical-uw' };
  const aliasStage = (id) => (id && RETIRED[id]) || id;

  /* Schema repair for configs saved before a change. Runs on the defaults
     AND on whatever an owner has saved to config/pipelines, so a stored
     copy from before these edits still lands on the current board:

     · delivery-signed used to be a Submitted stage named for its exit
       ("…Signed"). It is post-close work, so the bucket is forced; the
       label is only updated when it still carries the old default, so a
       deliberate rename holds.
     · Schedule Medical Visit is retired — the case manager owns that as a
       workflow task, and it did not earn a column.
     · Hit List is inserted straight after Uncovered on every track. */
  function repair(c) {
    (c.pipelines || []).forEach(pl => {
      const stages = pl.stages || [];
      stages.forEach(st => {
        if (st.id !== 'delivery-signed') return;
        st.bucket = 'Closed';
        if (st.label === 'Delivery Requirements Signed') st.label = 'Delivery Requirements';
      });
      const gone = stages.findIndex(st => st.id === 'sched-medical');
      if (gone >= 0) stages.splice(gone, 1);
      if (!stages.some(st => st.id === 'hit-list')) {
        const u = stages.findIndex(st => st.id === 'uncovered');
        stages.splice(u >= 0 ? u + 1 : 0, 0, { id: 'hit-list', label: 'Hit List', bucket: 'Opened' });
      }
      pl.stages = stages;
    });
    return c;
  }

  let cfg = repair(DEFAULTS);
  let unsub = null;

  // Reads config/pipelines when it exists (the future editor writes it);
  // silently keeps the defaults when it does not. Idempotent.
  function init() {
    if (unsub || !RWG.fb) return;
    unsub = RWG.fb.db.collection('config').doc('pipelines').onSnapshot(
      d => {
        cfg = repair((d.exists && d.data() && d.data().value) ? d.data().value : DEFAULTS);
        if (RWG.app && RWG.app.renderMain) RWG.app.renderMain();
      },
      e => console.error('pipelines config listener:', e && e.message));
  }

  const pipelines = () => cfg.pipelines;
  const pipeline = (id) => cfg.pipelines.find(p => p.id === id) || null;
  const lostReasons = () => (cfg.lostReasons || DEFAULTS.lostReasons).slice();

  // The track is derived from the product, never chosen by hand.
  function pipelineForProduct(prodId) {
    return cfg.pipelines.find(p => (p.products || []).indexOf(prodId) >= 0) || cfg.pipelines[0];
  }

  const stageOf = (pl, stageId) => (pl && pl.stages.find(s => s.id === stageId)) || null;
  function bucketOf(prodId, stageId) {
    const s = stageOf(pipelineForProduct(prodId), stageId);
    return s ? s.bucket : null;
  }
  const stageLabel = (prodId, stageId) => {
    const s = stageOf(pipelineForProduct(prodId), stageId);
    return s ? s.label : '';
  };

  // Board columns = every stage except Lost (losses live behind a count).
  const boardStages = (pl) => pl.stages.filter(s => s.bucket !== 'Lost');

  // Where a case sits, granular. Falls back from the legacy state field
  // to the first stage of that bucket — read-time only, nothing written.
  function stageForCase(c) {
    const pl = pipelineForProduct(c.product);
    const sid = aliasStage(c.stageId);
    if (sid && stageOf(pl, sid)) return sid;
    if (c.state === 'Closed') return 'won';
    if (c.state === 'Lost') return 'lost';
    const bucket = c.state === 'Submitted' ? 'Submitted' : 'Opened';
    const first = pl.stages.find(s => s.bucket === bucket);
    return first ? first.id : pl.stages[0].id;
  }

  // Prev/next within the pipeline, for the arrow buttons (and mobile).
  // Won is reachable only through the close review, so next stops before it.
  function neighborStage(c, dir) {
    const pl = pipelineForProduct(c.product);
    const cols = boardStages(pl);
    const i = cols.findIndex(s => s.id === stageForCase(c));
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return null;
    if (cols[j].bucket === 'Closed') return null;
    return cols[j];
  }

  /* The chargeback clock. An insurance policy whose delivery receipt is
     not signed by policy month 3 charges the commission back. The clock
     starts when we are paid — the confirmed close — and falls back to when
     the case entered its closed stage for the window between push and
     confirm. Null for anything not sitting in Delivery Requirements. */
  const INS = { wl: 1, term: 1, di: 1, ltc: 1 };
  function receiptClock(c) {
    if (!c || !INS[c.product]) return null;
    if (stageForCase(c) !== 'delivery-signed') return null;
    const t = Date.parse(c.closedAt || c.stageAt || '') || null;
    if (!t) return null;
    const since = Math.max(0, Math.floor((Date.now() - t) / 86400000));
    return { since: since, left: 90 - since };
  }

  return {
    DEFAULTS, init, receiptClock, aliasStage,
    repairForTest: repair,   // the schema migration, exposed so it can be pinned
    pipelines, pipeline, pipelineForProduct, lostReasons,
    stageOf, bucketOf, stageLabel, boardStages, stageForCase, neighborStage,
    current: () => cfg   // the whole live config, for the settings editor's draft
  };
})();
