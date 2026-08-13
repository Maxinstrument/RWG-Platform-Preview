# Cutover — moving the Resilient CRM from preview to live

The preview and the live platform already share one Firebase project, one set of
security rules, and one book of data. **Cutover is therefore a code copy, not a
migration.** Nothing about the data moves; the only thing that changes is which
build the live URL serves. That is also why rollback is trivial.

Do this with Claude in a session, or by hand — every step is listed.

---

## Before the flip (10 minutes, any day)

1. **Backup.** Open `…/RWG-Platform-Preview/backup/`, sign in, download the JSON
   and CSVs. Two minutes of insurance.
2. **Rules are already live.** The published Firestore rules serve both builds.
   Confirm the last paste happened (Console → Firestore → Rules — should mention
   `tasks`, `splits`, `households`). No rules change is part of cutover.
3. **Tell the team.** Nothing they typed is lost — the same data appears in the
   new screens — but nav changes (My Work, Pipeline, Key dates, Service, and
   lead scoring now lives in CRM Settings).
4. **Play the preview one last day.** Anything that feels wrong is cheaper to
   fix before the flip than after.

## The flip (5 minutes)

The live repo is `1 Apps/RWG Platform` → github.com (live Pages URL).
The preview repo is `1 Apps/RWG Platform - PREVIEW`.

1. Copy the preview's files over the live working folder — everything **except**
   the `.git` folder:
   - `index.html`, `assets/` (all of it), `backup/`, `firestore.rules`, `CUTOVER.md`
   - `preview-banner.js` is safe to copy: it keys off the URL and draws nothing
     on the live site.
2. In the live repo: review the diff (`git diff --stat`), then commit and push:
   ```
   git add -A
   git commit -m "Cutover: Resilient CRM (preview build <hash>) goes live"
   git push origin main
   ```
3. Hard-refresh the live URL (Ctrl+Shift+R). GitHub Pages can take a minute.

## After the flip (10 minutes)

Smoke pass, in this order — each one proves a layer:

- [ ] Sign in works; nav shows Home · My Work · Key dates · Service · Pipeline · Inbox…
- [ ] **No preview banner** on the live URL (and still a banner on the preview URL).
- [ ] Home dashboard renders with real numbers; funnel and pace look sane.
- [ ] Open a household → people, opportunities, tasks, workflows all present.
- [ ] Open an opportunity from the board — the window shows its money correctly.
- [ ] Add a task; see it on My Work; complete it.
- [ ] CRM Settings opens; Lead scoring tab shows the current cutoffs.
- [ ] Scorecard shows this week's cases with granular stages.
- [ ] (Partner) Inbox: pending closes listed, close review opens.

## Rollback (2 minutes, no data at risk)

The data never moved, so rolling back is just serving the old code again:

```
git revert HEAD        # in the live repo
git push origin main
```

The preview URL keeps running the new build the whole time — nothing is lost by
rolling back, and the preview stays the staging ground for the next attempt.

## After life settles

- The preview repo **stays** as the permanent staging environment: build there,
  play there, copy to live when happy. Same discipline as this cutover.
- Deferred items on the list: advisor "own-share-only" splits view, team
  workload screen, weekly annuity/AUM targets in CRM Settings.
