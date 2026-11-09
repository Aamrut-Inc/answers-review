# Answer QA

Review site for the health assistant's answers, modelled on Chart QA.

The site is organised by patient. **Patients** (home) shows all 9 simulated patients as cards. Everything about one patient lives in one page (`patient.html?p=<n>`), with smooth animated transitions between its parts:

- **Profile** (`#profile`): summary, conditions, medications, clinical numbers with trends, wearable data, recent visits and the grounding brief. Every item can be flagged (hover → ⚑, right-click, or select text), with the same flag lists, comments, bin and versions as answers. Profile flags are saved under `patient-<n>`.
- **Questions & answers** (`#questions`): every question, with one row per batch and persona — judge levels, flags and edits at a glance.
- **Ask the assistant** (`#assistant`): Chart QA's assistant, over this patient's full clinical
  record — every lab reading, visit, note, medication order and wearable day, plus the generator's
  profile, limitations and methodology documents. The model asks for lookups and the *browser* runs
  them against `record.json`, so the chart is never shipped to the model wholesale;
  `functions/api/assistant.js` relays one model call at a time and keeps the API key server-side.
  Its answers are flaggable, under the patient's own flag list.
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

## Chart data (profile + assistant)

```
python scripts/sync_chart_data.py --from ../patient-review/data
python scripts/build_profiles.py
```

`sync_chart_data.py` pulls Chart QA's per-patient output into two places:
`profile_source/chart_qa/` (what `build_profiles.py` condenses into each patient page) and
`public/data/chart/<folder>/` (the full `index`/`content`/`wearable`/`record` the assistant reads
in the browser). This replaces what used to be a hand-copied snapshot, so refreshing is a command
rather than something to remember.

`record.json` is the large one — 1.4 MB for CKD, ~100 KB for the rest — and only the assistant
needs it. Everything under `public/data/` is gitignored and served behind sign-in.

**The assistant needs a key.** Either set `OPENAI_API_KEY` on this Pages project, or point
`ASSISTANT_WORKER_URL` (in `wrangler.toml`) at the Worker that already holds one and set the
`ASSISTANT_WORKER_SECRET` Pages secret to match its `APP_SHARED_SECRET`. Without either, the
assistant tab loads and every message returns a clear "isn't configured" error.

## Bringing Chart QA's flags across

Chart QA kept its patient flags in its own database (`patient_state`, plus a `review_events`
audit trail). Here a patient profile is just another reviewed thing, under the id `patient-<n>`,
so its flags belong in `review_state` alongside the answer flags.

```
python scripts/migrate_chart_flags.py --chart chart_state.json --events chart_events.json \
    --existing answer_state.json --dry-run      # see what would happen
```

The script's docstring has the exact `wrangler d1 execute` exports to feed it. It reads Chart
QA's database only, and writes SQL for you to read before applying — nothing is deleted, and
re-running the generated file would duplicate flags, so apply it once.

It has to reconcile four things. Flag ids: Chart QA mints `f<timestamp>`, this portal mints
`f1, f2…` from a per-row `seq`, so incoming flags are renumbered above the existing `seq` and
every reference to them — comments, bin entries, `version_history.flag_ids` — moves with them.
That matters because this portal may already hold flags on the same profile, raised from the
Profile view, and those must not be lost. `fixed_in_version`, which roll-back needs and Chart QA
doesn't store, is recovered from the version history. Chart QA's history assumes a v1 it never
records, so an explicit v1 is synthesised. And its dates are dates, not timestamps; they are
carried across as-is rather than padded with a fabricated time.

**The audit trail came too.** `review_events` is now part of `schema.sql` and every applied
operation appends to it, so the history Chart QA's team could query still answers the same
question — who raised a flag, and when — including for flags since deleted and purged. An edit's
replacement text is not copied into it; the version history already holds that.

```
wrangler d1 execute answer-review --remote --command \
  "SELECT answer_id, op, email, at FROM review_events ORDER BY id DESC LIMIT 50"
```

## Recovering data Braintrust no longer has

Braintrust logs expire, so `build_data.py` can only rebuild answers whose traces are still
inside the retention window — past that it reports `0 answers` and the cause isn't obvious.
A deployed instance is already serving the JSON built when those logs existed:

```
python scripts/fetch_deployed_data.py --from https://answer-review.pages.dev \
    --email you@aamrut.com --skip-patients
```

It signs in with the team password and copies `index.json`, `prompts.json` and every
`answers/<id>.json` down. This is the only way to recover judge scores for old answers, since
those were written into the build rather than re-read from Braintrust each time.

Pass `--skip-patients` when the local profile build is newer than the deployment's —
`build_profiles.py` now emits a `folder` field that older builds lack and the assistant needs.

**It does not bring reviewer flags or edits.** Those live in the deployment's D1, and come
across only by deploying to the same Pages project, or by exporting that database.

A local export from `export_braintrust_logs.py` also works as a source: drop its `Global.jsonl`
rows into `scripts/.cache/global_logs.json` as a JSON array and run `build_data.py --cached`.
That recovers the answers themselves, but not judge scores — the rubric judge runs as its own
`judge_eval` root rather than inside the `qa` trace, so the build never sees it.

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
| `public/assets/js/assistant.js` | Ask the assistant: tools, context, chat panel |
| `public/assets/js/chartlib.js` | Chart QA's formatting/stats helpers, used by the assistant |
| `scripts/sync_chart_data.py` | Chart QA's data → `profile_source/` + `public/data/chart/` |
| `scripts/migrate_chart_flags.py` | Chart QA's `patient_state` → `review_state` + `review_events` |
| `scripts/fetch_deployed_data.py` | Mirror a deployment's built data when Braintrust has expired |
| `public/assets/js/dashboard.js` | Team dashboard |
