# RWG Platform — Preview

The build site for the Resilient CRM. **Not the live platform.**

| | |
|---|---|
| **This site** | https://maxinstrument.github.io/RWG-Platform-Preview/ |
| **Live platform** | https://maxinstrument.github.io/RWG-Platform/ |
| **Backup tool** | https://maxinstrument.github.io/RWG-Platform-Preview/backup/ |

Work happens here first. Nothing reaches the live platform until Carlos calls it, and when he
does it moves across as one reviewed change rather than a trickle.

A gold strip runs across the top of every preview page so nobody confuses the two. It draws
itself from the URL rather than a flag, so it cannot be left on by accident when code moves to
the live repo.

## The one thing to understand

**Both sites talk to the same Firebase project** (`resilient-wealth-group`), so the preview shows
real leads, real cases and real people. Anything changed here is changed for everyone.

That is deliberate. Grouping the real book into households is the actual work of phase 1, and
doing it against a stale copy would mean doing it twice. The tradeoff is that the preview is not
a sandbox, so build work follows one rule:

> New features write only to **new** collections. Existing records (`leads`, `cases`, `users`,
> `weeks`, `reports`) are read-only from preview code, apart from additive, reversible fields
> such as the pointer that links a converted lead to its new household.

Firestore rules are project-wide and cannot tell the two sites apart, so that rule lives in the
code rather than on the server. Which is why the backup below exists.

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
Pages from trying to build it.

## What is being built

The full plan lives in the blueprint and screen-design documents. In order:

1. **Spine** — households, people, relationships, lead conversion, shared table engine
2. **Opportunities** — three pipelines, real stages, per-case rates, credit splits, close review
3. **Tasks** — assignment, My Work, team workload
4. **Workflows** — templates, instances, required sign-offs
5. **Dates** — birthdays, DROP windows, reviews, the AdvisorStream queue
6. **Scorecard** — derived from stage events instead of typed on a Friday
7. **Service layer, then cutover** — one door, and the old URLs retire
