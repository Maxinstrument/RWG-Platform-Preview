/* ============================================================
   RWG Platform — Scorecard configuration and money model

   THE SINGLE SOURCE OF TRUTH.

   The old system kept these constants in two files (the agent form and the
   management report), keyed differently (product ids vs product names), and
   they silently drifted apart. Nothing here may be duplicated anywhere else.

   ── The compensation model (confirmed by Carlos, 2026-07-10) ──────────────

   Agents type FYC (first-year commission) into "$ Amount" on insurance cases.
   We earn ~50% of the annual premium as FYC, therefore:

       annualized premium = Amount / 0.50 = Amount x 2
       monthly premium    = annualized / 12 = Amount / 6

   | Product        | "$ Amount" means | FYC    | Annualized premium | Revenue         | Club |
   |----------------|------------------|--------|--------------------|-----------------|------|
   | Whole Life     | FYC              | amount | amount x 2         | amount          | yes  |
   | Term           | FYC              | amount | amount x 2         | amount          | yes  |
   | Disability     | FYC              | amount | amount x 2         | amount          | yes  |
   | LTC            | commission       | 0      | 0                  | amount          | no   |
   | Annuity        | deposit          | 0      | 0                  | amount x 0.048  | no   |
   | Investments    | (ignored)        | 0      | 0                  | aum x 0.007     | no   |
   | Financial Plan | fee earned       | 0      | 0                  | amount          | no   |

   This corrects two live bugs:
     - the form computed premium as amount x 0.5, which is 3x the real monthly
       premium and dimensionally inconsistent with its own FYC formula;
     - the report computed amount / 6 for every non-annuity product, crediting
       investment accounts and financial plans with insurance premium they
       never generated.

   AUM no longer contributes a "premium equivalent" (the old aum/500 hack).
   AUM earns revenue at 0.70%. Premium means premium.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.scorecard = (function () {
  const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

  /* ── Products ─────────────────────────────────────────────
     `mult` is the recognition weight used for "weighted production" only.
     It never touches revenue, premium, or the Chairman's Club. */
  const PRODUCTS = [
    { id: 'wl',      name: 'Whole Life',     mult: 1.5 },
    { id: 'annuity', name: 'Annuity',        mult: 1.5 },
    { id: 'inv',     name: 'Investments',    mult: 1.0 },
    { id: 'term',    name: 'Term',           mult: 0.8 },
    { id: 'ltc',     name: 'LTC',            mult: 1.5 },
    { id: 'di',      name: 'Disability',     mult: 1.0 },
    { id: 'plan',    name: 'Financial Plan', mult: 1.3 }
  ];

  const SOURCES = [
    { id: 'pension_reg', label: 'Pension Member (Regular)',  premium: 1000 },
    { id: 'invest_plan', label: 'Investment Plan',           premium: 1000 },
    { id: 'pmax',        label: 'Pension Max',               premium: 1000 },
    { id: 'high_risk',   label: 'High Risk Member',          premium: 2000 },
    { id: 'haven',       label: 'Haven Life',                premium: 500  },
    { id: 'natural',     label: 'Natural Market (affluent)', premium: 2000 },
    { id: 'coi',         label: 'COI/Referral',              premium: 1000 },
    { id: 'current',     label: 'Current Client',            premium: 0    },
    { id: 'other',       label: 'Other',                     premium: 0    }
  ];

  const STATES = ['Opened', 'Submitted', 'Closed', 'Lost'];

  // Legacy data (Google Sheet) stores display names. Migration maps them back to ids.
  const PRODUCT_BY_ID   = {}; PRODUCTS.forEach(p => PRODUCT_BY_ID[p.id] = p);
  const PRODUCT_BY_NAME = {}; PRODUCTS.forEach(p => PRODUCT_BY_NAME[p.name] = p);
  const SOURCE_BY_ID    = {}; SOURCES.forEach(s => SOURCE_BY_ID[s.id] = s);
  const SOURCE_BY_LABEL = {}; SOURCES.forEach(s => SOURCE_BY_LABEL[s.label] = s);
  const SOURCE_PREMIUM  = {}; SOURCES.forEach(s => SOURCE_PREMIUM[s.id] = s.premium);

  const productName = (id) => (PRODUCT_BY_ID[id] || {}).name || '';
  const productId   = (name) => (PRODUCT_BY_NAME[name] || {}).id || '';
  const sourceLabel = (id) => (SOURCE_BY_ID[id] || {}).label || '';
  const sourceId    = (label) => (SOURCE_BY_LABEL[label] || {}).id || '';

  /* ── Rates ────────────────────────────────────────────────── */
  const COMMISSION_RATE          = 0.50;   // FYC as a share of annual premium
  const ANNUITY_REVENUE_RATE     = 0.048;  // 6% gross commission x 80% advisor payout
  const INVESTMENT_REVENUE_RATE  = 0.007;  // 0.70% of assets brought in

  // Insurance products where "$ Amount" is FYC and a client pays a real premium.
  // LTC is deliberately excluded: Carlos confirmed only Life and Disability count.
  const FYC_PRODUCTS     = ['wl', 'term', 'di'];
  const PREMIUM_PRODUCTS = FYC_PRODUCTS;   // identical set, named for intent
  const CLUB_PRODUCTS    = FYC_PRODUCTS;   // what counts toward the Chairman's Club

  /* ── The money functions. Everything keys on product ID, never on name. ── */

  // First-year commission earned on the case.
  function fyc(prodId, amount) {
    return FYC_PRODUCTS.indexOf(prodId) >= 0 ? n(amount) : 0;
  }

  // What the client pays per year. The number agents are held to weekly.
  function annualizedPremium(prodId, amount) {
    return PREMIUM_PRODUCTS.indexOf(prodId) >= 0 ? n(amount) / COMMISSION_RATE : 0;
  }

  // What the client pays per month.
  function monthlyPremium(prodId, amount) {
    return annualizedPremium(prodId, amount) / 12;
  }

  // Actual dollars the firm earns on the case.
  function revenue(prodId, amount, aum) {
    if (prodId === 'annuity') return n(amount) * ANNUITY_REVENUE_RATE;
    if (prodId === 'inv')     return n(aum)    * INVESTMENT_REVENUE_RATE;
    return n(amount);   // wl, term, di, ltc, plan: the amount typed is the money earned
  }

  // Recognition figure only. Never comp, never the Club.
  function weightedProduction(prodId, amount, aum) {
    const p = PRODUCT_BY_ID[prodId];
    return p ? revenue(prodId, amount, aum) * p.mult : 0;
  }

  const countsForClub = (prodId) => CLUB_PRODUCTS.indexOf(prodId) >= 0;

  /* ── What the agent types, per product ────────────────────────
     The agent NEVER types revenue. They enter the single number they
     actually know, and the platform derives everything else. This is the
     rule that broke down in the old system: agents were hand-entering
     revenue on investment cases, so the column never reconciled with the
     0.70% they are actually paid. */
  const INPUTS = {
    wl:      { field: 'amount', label: 'First-year commission (FYC)', hint: 'Annualized premium = FYC x 2' },
    term:    { field: 'amount', label: 'First-year commission (FYC)', hint: 'Annualized premium = FYC x 2' },
    di:      { field: 'amount', label: 'First-year commission (FYC)', hint: 'Annualized premium = FYC x 2' },
    ltc:     { field: 'amount', label: 'Commission earned',           hint: 'No premium credit. Not in the Club.' },
    annuity: { field: 'amount', label: 'Deposit placed',              hint: 'Revenue = 4.8% of the deposit', placed: true },
    inv:     { field: 'aum',    label: 'Assets brought in (AUM)',     hint: 'Revenue = 0.70% of assets',    placed: true },
    plan:    { field: 'amount', label: 'Planning fee earned',         hint: 'No premium credit' }
  };
  const inputFor = (prodId) => INPUTS[prodId] || { field: 'amount', label: '$ Amount', hint: '' };
  const usesAum  = (prodId) => inputFor(prodId).field === 'aum';

  /* ── Money the CLIENT placed, which is not money WE earned ────
     Only two products have one: a deposit into an annuity and assets
     brought into an investment account. On a life case or a planning
     engagement the number typed IS the commission or the fee — so every
     "Amount / AUM" column was printing the revenue figure a second time,
     one column to its left, where it read as a separate and much larger
     piece of business. There is no amount placed on a life case; the
     column now says so instead of repeating what Revenue already says.
     `placed` is declared per product, so a new one states its own case
     rather than inheriting a guess. Returns null for "no such thing",
     and 0 only when a deposit really is zero. */
  const placedOn = (prodId) => !!inputFor(prodId).placed;
  function placed(c) {
    if (!c || !placedOn(c.product)) return null;
    return usesAum(c.product) ? n(c.aum) : n(c.amount);
  }

  /* ── Per-case rates (phase 2) ─────────────────────────────
     Carlos's rule: you override the RATE, never the revenue. A case may
     carry `rate` (a fraction: 0.55, 0.0017…) and, on insurance,
     `premiumAnnual` (the real annual premium from the illustration).
     Blank means the product default below — which reproduces every
     historical number exactly, because the defaults ARE the old
     constants. Revenue is still calculated, every time, from a basis
     and a rate that are both on the record.

     A rate of 0/null/'' counts as unset: zeroing a rate is always a
     clearing, never a real commission schedule. */
  function builtinRate(prodId) {
    if (FYC_PRODUCTS.indexOf(prodId) >= 0) return COMMISSION_RATE;
    if (prodId === 'annuity') return ANNUITY_REVENUE_RATE;
    if (prodId === 'inv') return INVESTMENT_REVENUE_RATE;
    return null;   // ltc, plan: the amount typed IS the money, no rate
  }

  /* Settings (phase 5.5) can override a DEFAULT rate per product, via
     config/rates. An override steers every case that carries no rate of
     its own — including old open ones, which is said out loud in the
     editor. The built-ins above stay in code and reproduce every
     historical number the moment an override is cleared. Cases closed
     through the close review are frozen in their `applied` snapshot and
     never move either way. */
  let RATE_OVERRIDES = null;
  let ratesUnsub = null;
  function initRates() {
    if (ratesUnsub || !window.RWG || !RWG.fb) return;
    ratesUnsub = RWG.fb.db.collection('config').doc('rates').onSnapshot(
      d => {
        RATE_OVERRIDES = (d.exists && d.data() && d.data().value) || null;
        if (RWG.app && RWG.app.renderMain) RWG.app.renderMain();
      },
      e => console.error('rates config listener:', e && e.message));
  }
  const rateOverrides = () => RATE_OVERRIDES;

  function defaultRate(prodId) {
    if (RATE_OVERRIDES && Number(RATE_OVERRIDES[prodId]) > 0) return Number(RATE_OVERRIDES[prodId]);
    return builtinRate(prodId);
  }
  function caseRate(c) {
    const r = c && c.rate != null && c.rate !== '' ? Number(c.rate) : 0;
    return r > 0 ? r : defaultRate(c ? c.product : null);
  }
  function caseAnnualizedPremium(c) {
    if (PREMIUM_PRODUCTS.indexOf(c.product) < 0) return 0;
    const entered = Number(c.premiumAnnual);
    if (entered > 0) return entered;               // the real premium wins
    const r = caseRate(c);
    return r ? n(c.amount) / r : 0;
  }
  function caseRevenue(c) {
    if (c.product === 'annuity') return n(c.amount) * (caseRate(c) || 0);
    if (c.product === 'inv') return n(c.aum) * (caseRate(c) || 0);
    return n(c.amount);   // wl, term, di, ltc, plan: the amount typed is the money
  }
  // Same shape as derive(), so withMoney() and every consumer stay
  // compatible — plus the resolved rate for display.
  function deriveCase(c) {
    const ann = caseAnnualizedPremium(c);
    const rev = caseRevenue(c);
    const p = PRODUCT_BY_ID[c.product];
    return {
      fyc: fyc(c.product, c.amount),
      annualizedPremium: ann,
      monthlyPremium: ann / 12,
      revenue: rev,
      weightedProduction: p ? rev * p.mult : 0,
      countsForClub: countsForClub(c.product),
      rate: caseRate(c)
    };
  }

  // Everything a case is worth, from the one number the agent entered.
  function derive(prodId, amount, aum) {
    return {
      fyc:               fyc(prodId, amount),
      annualizedPremium: annualizedPremium(prodId, amount),
      monthlyPremium:    monthlyPremium(prodId, amount),
      revenue:           revenue(prodId, amount, aum),
      weightedProduction: weightedProduction(prodId, amount, aum),
      countsForClub:     countsForClub(prodId)
    };
  }

  // The form writes only the field its product uses, so the two can never disagree.
  function normalizeMoney(prodId, amount, aum) {
    return usesAum(prodId)
      ? { amount: 0,         aum: n(aum) }     // investments: assets only
      : { amount: n(amount), aum: n(aum) };    // everything else: amount is the money
  }

  // Records the migration must not import silently. Returns [] when a case is sound.
  function dataWarnings(c) {
    const id = c.product && c.product.length <= 8 ? c.product : productId(c.product);
    const amt = n(c.amount), aum = n(c.aum), out = [];
    if (usesAum(id)) {
      if (!aum && amt) out.push('Investment has a $ Amount but no AUM, so it earns $0 revenue. Needs the asset total.');
      if (aum && amt)  out.push('Investment has both a $ Amount and AUM. The $ Amount will be discarded.');
      if (!aum && !amt) out.push('Investment has neither AUM nor amount.');
    } else {
      if (aum && !usesAum(id)) out.push('AUM is recorded on a ' + (productName(id) || id) + ' case, where it earns nothing.');
      if (id === 'plan' && amt > 25000) out.push('Planning fee of ' + amt + ' is implausibly large. Likely the client assets, or the wrong product.');
    }
    return out;
  }

  /* ── Chairman's Club ──────────────────────────────────────── */
  const CHAIRMAN = {
    ANNUAL_FYC_GOAL_TOTAL: 1000000,   // combined partner FYC
    ANNUAL_FYC_GOAL_EACH:  500000,
    STARTING_FYC_TOTAL:    160000,    // booked before the sprint began
    WEEKS_IN_SPRINT:       25,
    SPRINT_START:          '2026-06-08',
    BIG_CASE_FYC:          20000
  };
  // Pace: $36,000 of FYC per week keeps the $1M goal on track.
  const FYC_PER_WEEK_AT_TARGET = 36000;
  // The same pace expressed as the number Carlos wants to manage against.
  const ANNUALIZED_PREMIUM_PER_WEEK_AT_TARGET = FYC_PER_WEEK_AT_TARGET / COMMISSION_RATE;  // $72,000

  /* ── Activity + weekly minimums ───────────────────────────── */
  const ACTIVITY_POINTS = {
    fa_sched: 1, fa_held: 2, opp_open: 2, ca_sched: 3,
    ca_held: 5, nb_written: 10, nb_closed: 15, referrals: 3
  };
  const WEEKLY_MIN = 35;           // associates
  const WEEKLY_MIN_PARTNER = 0;    // partners are scored on outcomes, not activity

  /* ── Per-agent goals ──────────────────────────────────────────
     Keyed by legacy name today; Phase 3 moves this into Firestore `config/agents`
     keyed by account id. `closeAnnualizedPremium` is a PLACEHOLDER: it restates the
     old (and incorrect) $500/$1000 "premium" goals into annualized dollars, pending
     Carlos setting real targets. Team pace is $72,000/week annualized. */
  const AGENT_GOALS = {
    'Jesus Zamora':         { firstSched: 7, firstHeld: 5, opps: 2, closingSched: 2, closingRun: 2, nbSub: 1, nbClosed: 1, referrals: 1, closeAnnualizedPremium: 12000, firmShare: 1.0, scorecardRole: 'associate' },
    'Maryurie Estrada':     { firstSched: 7, firstHeld: 5, opps: 2, closingSched: 2, closingRun: 2, nbSub: 1, nbClosed: 1, referrals: 1, closeAnnualizedPremium: 12000, firmShare: 1.0, scorecardRole: 'associate' },
    'Nelson Mompierre Jr.': { firstSched: 7, firstHeld: 5, opps: 2, closingSched: 2, closingRun: 2, nbSub: 1, nbClosed: 1, referrals: 1, closeAnnualizedPremium: 24000, firmShare: 0.5, scorecardRole: 'associate' },
    'Carlos A Temperan':    { firstSched: 7, firstHeld: 5, opps: 2, closingSched: 2, closingRun: 2, nbSub: 1, nbClosed: 1, referrals: 1, closeAnnualizedPremium: 12000, firmShare: 1.0, scorecardRole: 'partner' },
    'Alejandro Mendieta':   { firstSched: 7, firstHeld: 5, opps: 2, closingSched: 2, closingRun: 2, nbSub: 1, nbClosed: 1, referrals: 1, closeAnnualizedPremium: 12000, firmShare: 1.0, scorecardRole: 'partner' }
  };
  const goalsFor = (name) => AGENT_GOALS[name] || null;
  const firmShare = (name) => (AGENT_GOALS[name] && AGENT_GOALS[name].firmShare != null) ? AGENT_GOALS[name].firmShare : 1.0;
  const scorecardRole = (name) => (AGENT_GOALS[name] && AGENT_GOALS[name].scorecardRole) || 'associate';
  const weeklyFloor = (name) => scorecardRole(name) === 'partner' ? WEEKLY_MIN_PARTNER : WEEKLY_MIN;

  /* ── Week math ────────────────────────────────────────────────
     The scorecard week ends on FRIDAY (`weekEnding`, "yyyy-mm-dd").
     Saturday and Sunday map back to the Friday just passed, matching the
     backend's weekEndingFor_(). Computed on the Eastern calendar date, then
     shifted by whole days, so daylight saving can never move a week.
     (Note: the Leads CRM uses Monday-based Eastern weeks. Different tool,
     different convention, deliberately kept apart.) */
  const TZ = 'America/New_York';
  const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function easternParts(ms) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(ms));
    const o = {};
    parts.forEach(p => { if (p.type !== 'literal') o[p.type] = p.value; });
    return o;
  }

  // Any date or ISO stamp -> the Friday (yyyy-mm-dd) that labels its week.
  function weekEndingFor(v) {
    if (!v) return '';
    const d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    const e = easternParts(d.getTime());
    const monIdx = (WEEKDAY[e.weekday] + 6) % 7;        // Mon=0 .. Sun=6
    const base = Date.UTC(+e.year, +e.month - 1, +e.day);
    return new Date(base + (4 - monIdx) * 86400000).toISOString().slice(0, 10);
  }

  const currentWeekEnding = () => weekEndingFor(new Date());

  // The Eastern calendar date (yyyy-mm-dd) for a moment — used to highlight
  // "today" in the daily tally so an agent always knows which column is live.
  function easternDateKey(ms) {
    const e = easternParts(ms == null ? Date.now() : ms);
    return e.year + '-' + e.month + '-' + e.day;
  }
  const todayKey = () => easternDateKey(Date.now());

  // The individual days that make up a scorecard week, for the daily tally.
  // A week is labelled by its Friday and runs Mon..Sun; we surface Mon..Sat by
  // default (Sunday is almost always empty; Saturday holds seminar activity).
  // Pure date arithmetic on the Friday label, so daylight saving can't shift it.
  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function weekDays(weekEnding, count) {
    count = count || 6;                       // Mon..Sat
    if (!weekEnding) return [];
    const base = Date.UTC(+weekEnding.slice(0, 4), +weekEnding.slice(5, 7) - 1, +weekEnding.slice(8, 10));
    const out = [];
    for (let i = 0; i < count; i++) {
      const dt = new Date(base + (i - 4) * 86400000);   // i=0 -> Monday (Friday - 4 days)
      out.push({ key: dt.toISOString().slice(0, 10), label: DOW_LABELS[i] || '', dom: dt.getUTCDate(), month: MONTHS[dt.getUTCMonth()] });
    }
    return out;
  }

  // Every Friday of a calendar year, in order (the week picker's source).
  function fridaysOfYear(year) {
    const out = [];
    const d = new Date(Date.UTC(year, 0, 1));
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);   // first Friday
    while (d.getUTCFullYear() === year) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 7);
    }
    return out;
  }

  // Which week each milestone belongs to. Opened week is immutable; the other
  // two are derived from the write-once stamps, exactly as the backend does.
  function deriveWeeks(c) {
    return {
      openedWeek:    c.openedWeek || c.week_ending || '',
      submittedWeek: c.submittedAt ? weekEndingFor(c.submittedAt) : '',
      closedWeek:    c.closedAt    ? weekEndingFor(c.closedAt)    : ''
    };
  }

  // A case counts once per week, at the furthest milestone it reached that week.
  function bucketForWeek(c, weekEnding) {
    if (!weekEnding) return null;
    const w = deriveWeeks(c);
    if (w.closedWeek    === weekEnding) return 'Closed';
    if (w.submittedWeek === weekEnding) return 'Submitted';
    if (w.openedWeek    === weekEnding) return 'Opened';
    return null;
  }

  const activeInWeek = (c, weekEnding) => bucketForWeek(c, weekEnding) !== null;

  // Co-credited teammates, from either the new array or the legacy "A; B" string.
  function coCredit(c) {
    if (Array.isArray(c.coCreditNames)) return c.coCreditNames.slice();
    return String(c.agent_involved || '').split(/[;,]/)
      .map(s => s.trim())
      .filter(s => s && s.toLowerCase() !== 'none');
  }

  /* ── everyone on the case, owner first ──
     Carlos, 30 Aug '26: picking his name on the Opportunity board showed
     him the cases he OWNS and nothing else — so the 45 cases Alejandro is
     working but does not own were invisible under the filter with his name
     on it. Ownership is the right answer for a scorecard (one case, one
     week, one person's number) and the wrong answer for "show me my work",
     and the board is the second question.

     One list, defined once, because every screen that answers "is this
     person on this case" has to answer it the same way — a board saying 38
     and a table saying 16 for the same name is a bug whichever one you
     believe.

     Names, not uids, deliberately. The same person has carried two
     accounts through a re-register, and the dropdown this feeds shows one
     entry per person; matching on the name keeps a case found no matter
     which account was on it the day it was written. De-duped and
     blank-free: a co-credit tick that outlived an owner change would
     otherwise list somebody twice. */
  function involvedNames(c) {
    const out = [], seen = {};
    [c.agentName].concat(coCredit(c)).forEach(n => {
      const s = String(n == null ? '' : n).trim();
      if (!s || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }
  // Is this person on the case at all — as owner or alongside? No name is
  // no filter, so callers can hand the select's value straight through.
  const involves = (c, name) => !name || involvedNames(c).indexOf(String(name)) >= 0;

  return {
    PRODUCTS, SOURCES, STATES, SOURCE_PREMIUM,
    productName, productId, sourceLabel, sourceId,
    COMMISSION_RATE, ANNUITY_REVENUE_RATE, INVESTMENT_REVENUE_RATE,
    FYC_PRODUCTS, PREMIUM_PRODUCTS, CLUB_PRODUCTS, countsForClub,
    fyc, annualizedPremium, monthlyPremium, revenue, weightedProduction,
    INPUTS, inputFor, usesAum, derive, normalizeMoney, dataWarnings,
    defaultRate, builtinRate, initRates, rateOverrides,
    caseRate, caseAnnualizedPremium, caseRevenue, deriveCase,
    CHAIRMAN, FYC_PER_WEEK_AT_TARGET, ANNUALIZED_PREMIUM_PER_WEEK_AT_TARGET,
    ACTIVITY_POINTS, WEEKLY_MIN, WEEKLY_MIN_PARTNER,
    AGENT_GOALS, goalsFor, firmShare, scorecardRole, weeklyFloor,
    placed, placedOn,
    weekEndingFor, currentWeekEnding, fridaysOfYear,
    easternDateKey, todayKey, weekDays,
    deriveWeeks, bucketForWeek, activeInWeek, coCredit, involvedNames, involves
  };
})();
