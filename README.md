# Answer QA

Review site for the health assistant's answers, modelled on Chart QA.

The site is organised by patient. **Patients** (home) shows all 9 simulated patients as cards. Everything about one patient lives in one page (`patient.html?p=<n>`), with smooth animated transitions between its parts:

- **Profile** (`#profile`): summary, conditions, medications, clinical numbers with trends, wearable data, recent visits and the grounding brief. Every item can be flagged (hover → ⚑, right-click, or select text), with the same flag lists, comments, bin and versions as answers. Profile flags are saved under `patient-<n>`.
- **Questions & answers** (`#questions`): every question, with one row per batch and persona — judge levels, flags and edits at a glance.
- **Review activity** (`#activity`).
- **An answer** (`#answer=<id>`): opening one folds the sidebar into a rail and glides the question into the header; `answer.html?answer=<id>` forwards old links here.

Each answer shows:

- **Conversation:** the coaching conversation before the question, with turn numbers matching the judges' turn numbers.
- **The answer:** the current version, the answer as generated, the pipeline's first draft (when it revised itself), and a word-level diff.
- **Judge scores:** the five rubric judges' levels (levels, not percentages: 0.67 = Level 3 of 4), each with its rationale, claim and citation checks, and clickable flagged turns. Reviewers can record their own level.
- **How it was answered:** every tool call, with inputs and outputs.
- **System prompts:** the assistant's system prompt (per batch), the faithfulness judge prompt, and the rubric judge prompts (once added; see below).
- **Quick edits:** hover any paragraph of the answer and click **Edit** to change it in place (Ctrl+Enter saves it as a new version) or **Flag** to raise an issue on it. A **Patient snapshot** panel and **Prev / Next** buttons (or the ← → keys) keep you inside the patient's answers.
- **Flags:** select text or right-click anywhere to flag it. Flags have urgency, a category, a proposed fix and an optional suggested rewrite. You can comment on them, delete them to a bin and restore them.
- **Versions:** v1 is always the generated answer and can't be changed. An edit, a batch of fixes or a roll-back each adds a version. Roll-back is non-destructive.
- **Team dashboard:** average level per batch × rubric, level distribution, reviewer-vs-judge agreement, judge-run health, flags, and activity.

Batches are Braintrust `config_version`s.

## Patient profiles

```
python scripts/build_profiles.py
```

Builds `public/data/patients.json` and `public/data/patients/<n>.json` from `profile_source/chart_qa/` (a snapshot of Chart QA's per-patient data) plus the grounding briefs in `../11-All_Profiles_Persona_Conversations_Extended/`.

## Refresh the data from Braintrust

```
python scripts/build_data.py            # pulls the "Global" project logs
python scripts/build_data.py --cached   # rebuild from the last download
```

Only answers asked within a conversation (with prior turns) are kept; cold, single-question runs are dropped, and the build prints how many per batch. The Braintrust key comes from `BRAINTRUST_API_KEY`, or the `BRAINTRUST…=` line of `../API_keys.txt`. The build reports how many judge runs failed and why, and warns if a judge cites a turn number that the answer's timeline doesn't have.

**Rubric judge prompts:** they live in the scorer code, not the logs. Save each one as `judge_prompts/<key>.md` (keys: `reasoning`, `user_data`, `research`, `missing_info`, `intent`), then rebuild.

After rebuilding, redeploy (below). Reviewer state is keyed by answer id (the first 16 characters of the Braintrust root span id), so it survives rebuilds.

## Run locally

```
wrangler d1 execute answer-review --local --file=schema.sql   # once
wrangler pages dev --port 8788
```

`.dev.vars` holds the local `TEAM_PASSWORD` and `SESSION_SECRET`.

## Deploy (Cloudflare Pages + D1)

```
wrangler login
wrangler d1 create answer-review                     # put the id in wrangler.toml
wrangler d1 execute answer-review --remote --file=schema.sql
wrangler pages project create answer-review --production-branch main
wrangler pages secret put TEAM_PASSWORD --project-name answer-review
wrangler pages secret put SESSION_SECRET --project-name answer-review
wrangler pages deploy
```

Sign-in: any `@aamrut.com` email (`ALLOWED_DOMAIN` in `wrangler.toml`) plus the team password.

## Layout

| Path | What |
|---|---|
| `scripts/build_data.py` | Braintrust logs → `public/data/` (index, one file per answer, prompts) |
| `functions/_middleware.js` | Everything except sign-in requires a session |
| `functions/_lib/review.js` | Review operations (flags, comments, edits, versions, bin, reviewer levels) |
| `functions/api/state/[id].js` | Shared per-answer state in D1, optimistic concurrency on `rev` |
| `scripts/build_profiles.py` | Chart QA snapshot + grounding briefs → `public/data/patients/` |
| `public/assets/js/home.js` | Patient cards |
| `public/assets/js/patient.js` | The patient space: routing, view transitions, sidebar/rail, profile, questions, activity |
| `public/assets/js/profile.js` | Profile rendering (flaggable full view, compact snapshot) |
| `public/assets/js/answerview.js` | The answer view (conversation, answer editing, scores, tools, prompts) |
| `public/assets/js/reviewkit.js` | Shared review strip, flag lists, comments, bin, versions |
| `public/assets/js/flagging.js` | Select / right-click to flag, badges, jump to location |
| `public/assets/js/dashboard.js` | Team dashboard |
