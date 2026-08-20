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
  /* What this person is to the FIRM — which is a different question from
     what they are to their family (RELATIONSHIPS, above). A spouse can be
     a client; a client's brother can be a COI. */
  const CONTACT_TYPES = ['Client', 'Past Client', 'Prospect', 'COI'];
  /* States are a field, not a line of text. You can only write business
     where a client resides and suitability asks for it, so "who do we have
     in Georgia" has to be answerable without grepping a string. */
  const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
    'OH','OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  const PHONE_LABELS = ['Work', 'Home', 'Mobile', 'Fax', 'Other'];
  const EMAIL_LABELS = ['Personal', 'Work', 'Other'];

  /* People have more than one number. The record keeps LISTS —
     phones:[{v,label}], emails:[{v,label}] — while `phone` and `email`
     stay as mirrors of the first entry, because a dozen screens, the
     duplicate check, the CSV and the AdvisorStream list all read those
     two fields. Writing the mirror on save keeps every one of them
     working without a risky sweep, and makes "the first one" mean
     "the one we use", which is what the order in the editor is for.

     Legacy rows carry only the flat fields, so reading normalises them
     into a one-entry list — at read time, nothing written, no label
     invented for a number nobody labelled. */
  /* ── Where we mail things ──────────────────────────────────
     The HOUSEHOLD holds the address and a person may override it. Most
     families share one, and an address typed twice is an address that
     will disagree with itself by next year; the override is for the one
     who lives somewhere else — a student, a parent in care, an ex-spouse
     still on the file.

     This is not the system of record. The carrier and A360 are. A stale
     address is worse than a blank one because somebody will trust it, so
     every save stamps when it was last confirmed and the screens say how
     long ago that was. */
  function normalizeAddr(a) {
    if (!a) return null;
    const t = (k) => String(a[k] == null ? '' : a[k]).trim();
    const out = { line1: t('line1'), line2: t('line2'), city: t('city'),
      state: t('state').toUpperCase().slice(0, 2), zip: t('zip') };
    return (out.line1 || out.city || out.state || out.zip) ? out : null;
  }
  const hasAddress = (a) => !!normalizeAddr(a);
  const sameAddr = (a, b) => JSON.stringify(normalizeAddr(a)) === JSON.stringify(normalizeAddr(b));
  // One line, the way an envelope reads it.
  function addrLine(a) {
    a = normalizeAddr(a); if (!a) return '';
    const street = [a.line1, a.line2].filter(Boolean).join(', ');
    const town = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [street, town].filter(Boolean).join(', ');
  }
  /* The address to use for a person, and where it came from — the screens
     say "from the household" so nobody edits the family's address thinking
     they are correcting one person's. */
  function addressFor(c) {
    if (!c) return { addr: null, from: null, at: '' };
    if (hasAddress(c.address)) return { addr: normalizeAddr(c.address), from: 'contact', at: c.addressAt || '' };
    const h = c.householdId ? household(c.householdId) : null;
    if (h && hasAddress(h.address)) return { addr: normalizeAddr(h.address), from: 'household', at: h.addressAt || '', householdId: h.id };
    return { addr: null, from: null, at: '' };
  }
  /* Employers, counted. Carlos asked how many people we have from a given
     company; the roll-up is the answer, and it doubles as a filter. Same
     rule as tags — no registry, the list is what is in use. */
  function allEmployers() {
    const counts = {}, label = {};
    cache.contacts.forEach(c => {
      const raw = String(c.employer || '').trim(); if (!raw) return;
      const k = raw.toLowerCase();
      counts[k] = (counts[k] || 0) + 1; label[k] = label[k] || raw;
    });
    return Object.keys(counts)
      .map(k => ({ employer: label[k], count: counts[k] }))
      .sort((a, b) => b.count - a.count || a.employer.localeCompare(b.employer));
  }

  function normalizeWays(list, flat) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(w => {
      const v = String((w && w.v) || '').trim();
      if (v) out.push({ v: v, label: String((w && w.label) || '') });
    });
    if (!out.length && String(flat || '').trim()) out.push({ v: String(flat).trim(), label: '' });
    return out;
  }
  const phonesOf = (c) => normalizeWays(c && c.phones, c && c.phone);
  const emailsOf = (c) => normalizeWays(c && c.emails, c && c.email);
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
  /* What to call them out loud. A preferred name is how a person wants to
     be addressed — Bob for Robert, a middle name, an anglicised name — so
     it wins for greetings and first-name displays. The legal first and
     last names are untouched: applications and carrier paperwork need the
     name on the driver's licence, not the one on the birthday card. */
  const callName = (c) => ((c && c.preferredName) || '').trim() || ((c && c.firstName) || '').trim();
  const spokenName = (c) => `${callName(c)} ${(c && c.lastName) || ''}`.trim();

  // ── duplicate matching (same normalisation the leads import uses) ──
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  const phoneKey = (p) => { const d = digits(p); return d.length >= 10 ? d.slice(-10) : (d.length >= 7 ? d : ''); };
  const emailKey = (e) => { const s = String(e == null ? '' : e).trim().toLowerCase(); return /.+@.+\..+/.test(s) ? s : ''; };
  // Someone already in the book with this phone or email (soft warn, never a block).
  function findDupContact(phone, email, ignoreId) {
    const pk = phoneKey(phone), ek = emailKey(email);
    return cache.contacts.find(c => c.id !== ignoreId &&
      ((pk && phonesOf(c).some(w => phoneKey(w.v) === pk))
        || (ek && emailsOf(c).some(w => emailKey(w.v) === ek)))) || null;
  }

  // ── tags ──
  // There is no tag registry: a tag exists because a contact wears it.
  // Nothing to keep in sync, and renaming is a find-and-replace over use.
  const cleanTag = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, 40);
  function parseTags(input) {
    const seen = {}, out = [];
    String(input == null ? '' : input).split(',').forEach(raw => {
      const t = cleanTag(raw);
      const k = t.toLowerCase();
      if (t && !seen[k]) { seen[k] = 1; out.push(t); }
    });
    return out;
  }
  // Every tag in use, with a count, most-used first then alphabetical.
  function allTags() {
    const counts = {}, label = {};
    cache.contacts.forEach(c => (c.tags || []).forEach(t => {
      const k = cleanTag(t).toLowerCase(); if (!k) return;
      counts[k] = (counts[k] || 0) + 1; label[k] = label[k] || cleanTag(t);
    }));
    return Object.keys(counts)
      .map(k => ({ tag: label[k], count: counts[k] }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
  const hasTag = (c, tag) => (c.tags || []).some(t => cleanTag(t).toLowerCase() === cleanTag(tag).toLowerCase());

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
      address: null, addressAt: '',             // where the family lives
      source: '', sourceDetail: '', notes: '', links: [],
      a360Complete: null,                       // {by, byName, at} once checked
      createdAt: now(), createdBy: (me && me.id) || null, updatedAt: now()
    }, fields);
    h.address = normalizeAddr(h.address);
    if (h.address && !h.addressAt) h.addressAt = new Date().toISOString();
    cache.households.push(h); onChange();
    persistHousehold(h);
    return h;
  }

  function saveHousehold(patch) {
    const h = household(patch.id); if (!h) return;
    const sentAddr = patch && Object.prototype.hasOwnProperty.call(patch, 'address');
    Object.assign(h, patch, { updatedAt: now() });
    if (sentAddr) {
      h.address = normalizeAddr(h.address);
      h.addressAt = h.address ? new Date().toISOString() : '';
    }
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

  /* Deleting a household lets its people go rather than taking them with
     it: a household is a grouping, and the person is the record that
     carries the notes, the tasks and the history. Everyone is detached
     and keeps a breadcrumb (formerHouseholdId) saying where they were —
     which is what lets a restore from the Trash put the family back
     together instead of leaving a named shell with nobody in it. */
  function deleteHousehold(id) {   // admin only (rules)
    const h = household(id);
    const people = contactsFor(id);
    const batch = db().batch();
    people.forEach(c => {
      c.householdId = null;
      c.formerHouseholdId = id;
      c.updatedAt = now();
      batch.set(db().collection('contacts').doc(c.id), stripId(c));
    });
    cache.households = cache.households.filter(x => x.id !== id);
    onChange();
    const detach = people.length
      ? batch.commit().catch(e => { console.error('detach people:', e && e.message); throw e; })
      : Promise.resolve();
    return detach.then(() => {
      if (h && RWG.trash) return RWG.trash.send('households', id, h, h.name);
      return db().collection('households').doc(id).delete()
        .catch(e => { console.error('delete household:', e && e.message); throw e; });
    });
  }

  /* The other half of the above: a household restored from the Trash
     gathers back everyone who was detached when it went — but only those
     still without a household, so a person deliberately moved somewhere
     else in the meantime is left where they were put. */
  function reattachHousehold(id) {
    const back = cache.contacts.filter(c => c.formerHouseholdId === id && !c.householdId);
    if (!back.length) return Promise.resolve(0);
    const batch = db().batch();
    back.forEach(c => {
      c.householdId = id;
      c.formerHouseholdId = null;
      c.updatedAt = now();
      batch.set(db().collection('contacts').doc(c.id), stripId(c));
    });
    onChange();
    return batch.commit().then(() => back.length)
      .catch(e => { console.error('reattach people:', e && e.message); throw e; });
  }

  // ── contact writes ──
  /* Keep the list and its mirror agreeing, in whichever direction the
     caller wrote. A form that sends lists is the authority — clearing
     every row must clear the number, not resurrect it from the mirror.
     A caller that only knows the flat field (converting a lead, an
     import) has its value promoted into the list instead of dropped. */
  function syncWays(c, patch) {
    const sent = (k) => patch && Object.prototype.hasOwnProperty.call(patch, k);
    c.phones = sent('phones') ? normalizeWays(patch.phones, null) : normalizeWays(c.phones, c.phone);
    c.phone = c.phones.length ? c.phones[0].v : '';
    c.emails = sent('emails') ? normalizeWays(patch.emails, null) : normalizeWays(c.emails, c.email);
    c.email = c.emails.length ? c.emails[0].v : '';
    return c;
  }

  function addContact(fields) {
    const ref = db().collection('contacts').doc();
    const c = Object.assign({
      id: ref.id, householdId: null, firstName: '', lastName: '',
      preferredName: '',               // what they actually go by — Bob for Robert
      contactType: '',                 // Client | Past Client | Prospect | COI
      phones: [], emails: [],          // [{v,label}] — phone/email mirror the first
      relationship: 'Other', email: '', phone: '', dob: '', employer: '',
      address: null, addressAt: '',     // null = use the household's

      planType: '', memberClass: '', yos: null, afc: null, age: null,
      tags: [],                        // free-form labels; the tag list is derived from use
      title: '', notes: '',            // job title, and anything the team should know
      keyDates: [],                    // DROP windows, retirement dates — a person's, not a family's
      leadId: null,                    // set when this person began as a lead
      advisorstream: false,            // on the newsletter list yet?
      createdAt: now(), createdBy: (me && me.id) || null, updatedAt: now()
    }, fields);
    ['yos', 'afc', 'age'].forEach(k => { c[k] = (c[k] === '' || c[k] == null) ? null : Number(c[k]); });
    c.address = normalizeAddr(c.address);
    if (c.address && !c.addressAt) c.addressAt = new Date().toISOString();
    syncWays(c, fields);
    cache.contacts.push(c); onChange();
    persistContact(c);
    return c;
  }

  function saveContact(patch) {
    const c = contact(patch.id); if (!c) return;
    // Re-confirming the same address still counts as confirming it — that
    // is what the annual review is for — so the stamp moves on every save
    // that carries one.
    const sentAddr = patch && Object.prototype.hasOwnProperty.call(patch, 'address');
    Object.assign(c, patch, { updatedAt: now() });
    ['yos', 'afc', 'age'].forEach(k => { if (c[k] === '' || c[k] == null) c[k] = null; else c[k] = Number(c[k]); });
    if (sentAddr) {
      c.address = normalizeAddr(c.address);
      c.addressAt = c.address ? new Date().toISOString() : '';
    }
    syncWays(c, patch);
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
    const c = contact(id);
    cache.contacts = cache.contacts.filter(x => x.id !== id);
    onChange();
    if (c && RWG.trash) return RWG.trash.send('contacts', id, c, contactName(c) || '(no name)');
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

  // Everything a lead already knows, in contact-record shape.
  function personFieldsFromLead(l) {
    return {
      firstName: l.firstName || '', lastName: l.lastName || '',
      email: l.email || '', phone: l.phone || '', dob: '',
      employer: l.employer || '', planType: l.planType || '',
      memberClass: l.memberClass || '', yos: l.yos != null ? l.yos : null,
      afc: l.afc != null ? l.afc : null, age: l.age != null ? l.age : null,
      leadId: l.id
    };
  }

  // Attach existing scorecard cases to a household — the additive pointer
  // that lets phase 2 hang opportunities off the spine. Pokes the
  // scorecard cache optimistically so the grouping screen recounts live.
  function attachCasesTo(batch, hhId, caseIds, stampISO) {
    (caseIds || []).forEach(cid => {
      batch.update(db().collection('cases').doc(cid), { householdId: hhId, updatedAt: stampISO });
      const sd = RWG.scorecardData;
      if (sd && sd.isStarted()) { const c = sd.caseById(cid); if (c) c.householdId = hhId; }
    });
  }

  // ── grouping (the one-time pass over the existing book) ──
  // One atomic batch: household (new or existing) + person (from a lead,
  // from a bare name, or none when they are already a contact) + every
  // case in the group stamped with the pointer.
  //
  // opts: { householdId }  OR  { household: {name, advisorUid, advisorName, source} }
  //       + one of: fromLeadId | person {firstName,lastName} | nothing
  //       + relationship, caseIds[]
  function createFromGrouping(opts) {
    const batch = db().batch();
    const stamp = now();
    const stampISO = new Date(stamp).toISOString();
    const by = (me && me.id) || null;

    let hh;
    if (opts.householdId) {
      hh = household(opts.householdId);
      if (!hh) return Promise.reject(new Error('household not found'));
    } else {
      const ref = db().collection('households').doc();
      hh = Object.assign({
        id: ref.id, name: '', advisorUid: null, advisorName: '',
        source: '', sourceDetail: '', notes: '', links: [], a360Complete: null,
        createdAt: stamp, createdBy: by, updatedAt: stamp
      }, opts.household || {});
      if (!hh.name) return Promise.reject(new Error('the household needs a name'));
      cache.households.push(hh);
      batch.set(db().collection('households').doc(hh.id), stripId(hh));
    }

    let personId = null;
    let fields = null;
    if (opts.fromLeadId) {
      const l = RWG.data.lead(opts.fromLeadId);
      if (!l) return Promise.reject(new Error('lead not found'));
      if (l.householdId) return Promise.reject(new Error(RWG.data.fullName(l) + ' was already converted — refresh the proposals'));
      fields = personFieldsFromLead(l);
      const hist = {
        id: 'h_' + stamp.toString(36), by: by, at: stamp, changes: [],
        note: '✦ Grouped into household "' + hh.name + '" — client record created'
      };
      batch.update(db().collection('leads').doc(l.id), {
        householdId: hh.id, contactId: null,   // set below once the id exists
        convertedAt: stamp, convertedBy: by,
        history: firebase.firestore.FieldValue.arrayUnion(hist)
      });
    } else if (opts.person && (opts.person.firstName || opts.person.lastName)) {
      fields = Object.assign({ leadId: null }, opts.person);
    }
    if (fields) {
      const cRef = db().collection('contacts').doc();
      const person = Object.assign({
        id: cRef.id, householdId: hh.id,
        relationship: opts.relationship || 'Primary client',
        email: '', phone: '', dob: '', employer: '', planType: '',
        memberClass: '', yos: null, afc: null, age: null,
        advisorstream: false,
        createdAt: stamp, createdBy: by, updatedAt: stamp
      }, fields);
      personId = person.id;
      cache.contacts.push(person);
      batch.set(cRef, stripId(person));
      if (opts.fromLeadId) batch.update(db().collection('leads').doc(opts.fromLeadId), { contactId: personId });
    }

    attachCasesTo(batch, hh.id, opts.caseIds, stampISO);

    onChange();
    return batch.commit()
      .then(() => ({ householdId: hh.id, contactId: personId }))
      .catch(e => { console.error('grouping:', e && e.message); throw e; });
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
    const person = Object.assign({
      id: cRef.id, householdId: hh.id,
      relationship: opts.relationship || 'Primary client',
      advisorstream: false,
      createdAt: stamp, createdBy: by, updatedAt: stamp
    }, personFieldsFromLead(l));
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
    RELATIONSHIPS, CONTACT_TYPES, PHONE_LABELS, EMAIL_LABELS, STATES,
    normalizeAddr, hasAddress, sameAddr, addrLine, addressFor, allEmployers,
    phonesOf, emailsOf, LINK_KINDS, linkLabel,
    init, teardown, isStarted,
    households, household, contacts, contact, contactsFor, primaryContact, contactName,
    callName, spokenName,
    findDupContact, upcomingBirthdays,
    parseTags, allTags, hasTag,
    addHousehold, saveHousehold, setA360, deleteHousehold, reattachHousehold,
    addContact, saveContact, setAdvisorstream, removeContact,
    linkHouseholds, unlinkHouseholds,
    convertLead, createFromGrouping,
    _cache: cache
  };
})();
