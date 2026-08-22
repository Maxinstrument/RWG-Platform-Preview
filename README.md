# The Resilient CRM

The firm's CRM. **This repo is the live one** — it serves
https://crm.yourresilientwealth.com and there is no other.

| | |
|---|---|
| **Live CRM** | https://crm.yourresilientwealth.com |
| **Backup tool** | https://crm.yourresilientwealth.com/backup/ |
| **Firebase project** | `resilient-wealth-group` |

## History, because the names are misleading

This folder is called "RWG Platform - PREVIEW" and the GitHub repo is
`RWG-Platform-Preview`. Both names are left over from when it was the
rehearsal for a separate live site. It stopped being that at the cutover on
18 Aug 2026: this became the real thing, and the two older builds —
`Maxinstrument/CRM` (the lead tracker) and `Maxinstrument/RWG-Platform` —
were taken off GitHub Pages and archived on 22 Aug 2026.

Renaming this repo would break the Pages deployment for no gain, so the
names stay and this paragraph exists instead. **If you are ever choosing
between repos, the one with the longer, sillier name is the live one.**

## One Firebase project, one set of rules

Every build that ever existed pointed at the same Firebase project, which
is why the old ones had to come down rather than merely be ignored: a stale
copy of the app is not a museum piece, it is a second set of hands on the
live book.

The same fact has a sharper edge on the security rules. There is **one**
published rule set for the project, so publishing a rules file that covers
fewer collections silently revokes access to the rest. That happened on
22 Aug 2026 — an older, shorter `firestore.rules` was pasted into the
console and the whole CRM went blank until the right one replaced it. No
data was lost; none of it was readable either.

**The only rules file to publish is `firestore.rules` in this repo.** The
copies in the archived repos have been renamed `firestore.rules.OLD-DO-NOT-
PUBLISH` and carry a banner explaining what they break. Rules are pasted by
hand in the Firebase console — a `git push` does not deploy them.

## Back up before anything that touches data

Open `/backup/`, sign in with the owner account, and download the JSON. It reads every
collection and writes nothing. Keep the file somewhere backed up and access-controlled: it holds
real client names, phones, emails, ages and salaries.

The JSON is a restore *point*, not a restore *button*. Putting data back is deliberate work with
real risk, so it is not automated.

## Publishing

```
cd "1 Apps/RWG Platform - PREVIEW"
git add -A
git commit -m "what changed"
git push
```

GitHub Pages serves it a minute or two later. Source is `main` / root, and `.nojekyll` keeps
Pages from trying to build it. This is the live CRM, so a push is a release: there is no
staging site any more, and the team is in here during the working day.

## What is being built

The full plan lives in the blueprint and screen-design documents. In order:

1. **Spine** — households, people, relationships, lead conversion, shared table engine
2. **Opportunities** — three pipelines, real stages, per-case rates, credit splits, close review
3. **Tasks** — assignment, My Work, team workload
4. **Workflows** — templates, instances, required sign-offs
5. **Dates** — birthdays, DROP windows, reviews, the AdvisorStream queue
6. **Scorecard** — derived from stage events instead of typed on a Friday
7. **Service layer, then cutover** — one door, and the old URLs retire

All seven shipped. The cutover was 18 Aug 2026 and the old URLs retired on
22 Aug 2026, which is the last line of the plan and the reason this README
had to be rewritten: it described a rehearsal that had already become the
performance.
