"""Builds public/data/ from the Braintrust "Global" project logs.

    python scripts/build_data.py              # pull fresh logs from Braintrust
    python scripts/build_data.py --cached     # reuse scripts/.cache/global_logs.json

One "answer" = one `qa` trace: a profile's question, the conversation that
led up to it, the assistant's answer (plus the pipeline's own groundedness
revision, when it ran), the tool calls behind it, the faithfulness judge and
the five rubric judges. Answers are grouped into batches by config_version.

Outputs (all read by the site; nothing here is reviewer state):
    public/data/index.json          batches, profiles, rubric scale, one summary row per answer
    public/data/answers/<id>.json   everything about one answer
    public/data/prompts.json        assistant system prompts (deduped), judge prompts
"""
import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "data")
CACHE = os.path.join(HERE, ".cache", "global_logs.json")
JUDGE_PROMPT_DIR = os.path.join(ROOT, "judge_prompts")
PROJECT = "Global"

# Level scale per rubric. A Braintrust score of 0.67 means "Level 3 of 4", not 67% correct.
RUBRICS = [
    {"key": "reasoning", "name": "Clear reasoning process", "short": "Clear reasoning", "max": 4},
    {"key": "user_data", "name": "Grounded in user data", "short": "Grounded in user data", "max": 4},
    {"key": "research", "name": "Grounded in real research", "short": "Grounded in research", "max": 4},
    {"key": "missing_info", "name": "Asks for missing information when needed", "short": "Asks for missing info", "max": 3},
    {"key": "intent", "name": "Identify and reconcile user intent/need", "short": "Intent / need", "max": 4},
]
RUBRIC_BY_NAME = {r["name"]: r for r in RUBRICS}
SCORE_TO_LEVEL = {4: {0.0: 1, 0.33: 2, 0.67: 3, 1.0: 4}, 3: {0.0: 1, 0.5: 2, 1.0: 3}}

TOOL_TEXT_LIMIT = 6000
DETAIL_KEYS = ["claims", "citations", "medical_claims", "turn_classifications", "turns", "judge_search_queries"]


def name(e):
    return (e.get("span_attributes") or {}).get("name")


def stype(e):
    return (e.get("span_attributes") or {}).get("type")


def clip(value, limit=TOOL_TEXT_LIMIT):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=1)
    return text if len(text) <= limit else text[:limit] + f"\n… [{len(text) - limit:,} more characters]"


def profile_label(raw):
    m = re.match(r"\s*(\d+)\s*-\s*(.*)", raw or "")
    if not m:
        return 999, raw or "Unknown"
    words = m.group(2).replace("_", " ").strip()
    special = {"ckd": "CKD", "adhd": "ADHD"}
    label = special.get(words.lower(), words[:1].upper() + words[1:])
    return int(m.group(1)), label


def response_text(output):
    """Text of an OpenAI Responses `output` list (skips encrypted reasoning items)."""
    if isinstance(output, str):
        return output
    parts = []
    for item in output or []:
        if isinstance(item, dict) and item.get("type") == "message":
            for c in item.get("content") or []:
                if isinstance(c, dict) and c.get("text"):
                    parts.append(c["text"])
    return "\n\n".join(parts)


def classify_error(err):
    s = str(err or "")
    if "reached your specifi" in s:
        return "Judge API usage limit reached"
    if "did not parse" in s:
        return "Judge reply wasn't valid JSON"
    if "No provider found" in s:
        return "Judge model not configured in Braintrust"
    if "Traceback" in s:
        tail = [l for l in s.strip().splitlines() if l.strip()][-1]
        return classify_error(tail) if tail != s else tail[:160]
    return s.splitlines()[0][:160] if s else "Unknown error"


def level_for(rubric, score, level):
    if isinstance(level, int):
        return level
    if score is None:
        return None
    table = SCORE_TO_LEVEL[rubric["max"]]
    return table.get(round(float(score), 2)) or min(table.items(), key=lambda kv: abs(kv[0] - score))[1]


def load_rows(cached):
    if cached and os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    sys.path.insert(0, HERE)
    from braintrust_client import fetch_logs, project_id
    print(f"Fetching Braintrust logs for project {PROJECT!r}…")
    rows = fetch_logs(project_id(PROJECT))
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    return rows


def build_answer(root, spans, prompt_ids):
    by_id = {s["span_id"]: s for s in spans}
    children = defaultdict(list)
    for s in spans:
        for p in s.get("span_parents") or []:
            children[p].append(s)
    ordered = sorted(spans, key=lambda s: s["created"])

    meta = root.get("metadata") or {}
    question = (root.get("input") or {}).get("question", "")
    revision_span = next((s for s in ordered if name(s) == "groundedness_revision"), None)
    revision_start = revision_span["created"] if revision_span else None

    # ---- conversation ----
    workflows = [s for s in ordered if name(s) == "Agent workflow" and isinstance(s.get("input"), list)]
    history, audit_message = [], None
    if workflows:
        msgs = [{"role": m.get("role"), "content": m.get("content") if isinstance(m.get("content"), str) else clip(m.get("content"))}
                for m in workflows[0]["input"]]
        if msgs and msgs[-1]["role"] == "user" and msgs[-1]["content"].strip() == question.strip():
            msgs = msgs[:-1]
        history = msgs
        if len(workflows) > 1 and workflows[-1]["input"]:
            last = workflows[-1]["input"][-1]
            audit_message = last.get("content") if isinstance(last.get("content"), str) else clip(last.get("content"))

    # ---- answers + system prompt ----
    responses = [s for s in ordered if name(s) == "Response"]
    texts = [response_text(r.get("output")) for r in responses]
    final_answer = (root.get("output") or {}).get("answer") or (texts[-1] if texts else "")
    original_answer = texts[0] if revision_span and texts and texts[0] else final_answer
    instructions = next(((r.get("metadata") or {}).get("instructions") for r in responses
                         if (r.get("metadata") or {}).get("instructions")), None)
    prompt_id = None
    if instructions:
        prompt_id = hashlib.sha1(instructions.encode()).hexdigest()[:10]
        prompt_ids.setdefault(prompt_id, {"id": prompt_id, "text": instructions, "batches": set(), "first_seen": root["created"]})
        prompt_ids[prompt_id]["batches"].add(meta.get("config_version") or "unknown")

    # ---- tool calls ----
    tools = []
    for s in ordered:
        if stype(s) != "tool":
            continue
        out = s.get("output")
        if isinstance(out, dict) and set(out) == {"preview"}:
            out = out["preview"]
        tools.append({
            "tool": name(s),
            "phase": "revision" if revision_start and s["created"] >= revision_start else "answer",
            "input": clip(s.get("input"), 3000),
            "output": clip(out) if out not in (None, "") else "",
            "error": clip(s.get("error"), 600) if s.get("error") else None,
        })
    # Some hosted tool calls (e.g. code_interpreter during the revision) have
    # no span of their own; recover them from the model's output items.
    for i, r in enumerate(responses):
        phase = "revision" if revision_start and r["created"] >= revision_start else "answer"
        calls = [o for o in r.get("output") or [] if isinstance(o, dict) and str(o.get("type", "")).endswith("_call")]
        have = sum(1 for t in tools if t["phase"] == phase)
        for item in calls[have:]:
            body = {k: v for k, v in item.items() if k not in ("id", "type", "status", "container_id")}
            out = body.pop("outputs", None) or body.pop("results", None)
            tools.append({"tool": item["type"][: -len("_call")], "phase": phase, "input": clip(body, 3000),
                          "output": clip(out) if out else "", "error": None, "from_model_output": True})
    tools.sort(key=lambda t: t["phase"] == "revision")

    # ---- judge timeline: the turn numbers the rubric judges cite ----
    # Reverse-engineered from the judges' turn references (checked against
    # every scored trace by main()): 1 = system prompt, then each history
    # message, the question, each tool call, the drafted answer, the
    # faithfulness check; if revised, the audit message, revision tool calls
    # and the revised draft; and last, the answer actually delivered.
    has_faith = any(name(s) == "faithfulness_judge" for s in ordered)
    timeline = [{"kind": "system"}]
    timeline += [{"kind": "history", "index": i} for i in range(len(history))]
    timeline.append({"kind": "question"})
    timeline += [{"kind": "tool", "index": i} for i, t in enumerate(tools) if t["phase"] == "answer"]
    timeline.append({"kind": "draft"})
    if has_faith:
        timeline.append({"kind": "faithfulness"})
    if revision_span:
        timeline.append({"kind": "audit"})
        timeline += [{"kind": "tool", "index": i} for i, t in enumerate(tools) if t["phase"] == "revision"]
        timeline.append({"kind": "revised_draft"})
    timeline.append({"kind": "final"})
    for i, t in enumerate(timeline):
        t["turn"] = i + 1

    # ---- faithfulness judge (the pipeline's own) ----
    faithfulness = []
    for s in ordered:
        if name(s) == "faithfulness_judge":
            out = s.get("output") or {}
            faithfulness.append({
                "created": s["created"],
                "phase": "revision" if revision_start and s["created"] >= revision_start else "answer",
                "score": (s.get("scores") or {}).get("faithfulness", out.get("score")),
                "verdict": out.get("verdict"),
                "unsupported_claims": out.get("unsupported_claims") or [],
                "error": classify_error(s.get("error")) if s.get("error") else None,
            })

    # ---- rubric judges: one run = one score span (+ its python runtime child) ----
    rubrics = {r["key"]: [] for r in RUBRICS}
    for s in ordered:
        rubric = RUBRIC_BY_NAME.get(name(s))
        if not rubric or stype(s) != "score":
            continue
        runtime = next((c for c in children[s["span_id"]] if name(c) == "python runtime"), None)
        out = (runtime or {}).get("output") or s.get("output")
        err = (runtime or {}).get("error") or s.get("error")
        run = {"created": s["created"]}
        md = (out or {}).get("metadata") or {}
        if out and md.get("error"):
            run.update(ok=False, error=classify_error(md["error"]), raw=clip(md.get("raw") or "", 4000))
        elif out and isinstance(out, dict) and (md.get("level") is not None or out.get("score") is not None):
            run.update(
                ok=True,
                score=out.get("score"),
                level=level_for(rubric, out.get("score"), md.get("level")),
                max=rubric["max"],
                rationale=md.get("rationale") or "",
                flagged_turns=md.get("flagged_turns") or [],
                details={k: md[k] for k in DETAIL_KEYS if md.get(k)},
                judge_tools_failed=bool(md.get("tool_span_fetch_failed")) or any(
                    "Error running tool" in str(t.get("output", "")) for t in md.get("judge_tool_calls") or []),
            )
        elif err:
            run.update(ok=False, error=classify_error(err))
        else:
            continue  # span still pending / empty
        rubrics[rubric["key"]].append(run)

    latest = {}
    for key, runs in rubrics.items():
        ok = [r for r in runs if r["ok"]]
        if ok:
            r = ok[-1]
            latest[key] = {"level": r["level"], "max": r["max"], "score": r["score"], "flagged_turns": r["flagged_turns"]}
    attempts = sum(len(v) for v in rubrics.values())
    errors = Counter(r["error"] for v in rubrics.values() for r in v if not r["ok"])
    if len(latest) == len(RUBRICS):
        status = "scored"
    elif latest:
        status = "partial"
    elif attempts:
        status = "failed"
    else:
        status = "not_scored"

    n, plabel = profile_label((root.get("input") or {}).get("profile"))
    answer_id = root["root_span_id"][:16]
    detail = {
        "id": answer_id,
        "braintrust_root_span_id": root["root_span_id"],
        "braintrust_row_id": root.get("id"),
        "batch": meta.get("config_version") or "unknown",
        "profile": {"n": n, "label": plabel, "raw": (root.get("input") or {}).get("profile")},
        "persona": meta.get("persona"),
        "question": question,
        "created": root["created"],
        "duration_s": round(((root.get("metrics") or {}).get("end", 0) - (root.get("metrics") or {}).get("start", 0)), 1) or None,
        "meta": {k: meta.get(k) for k in ["model", "pipeline", "family", "prior_turns", "tool_calls", "used_web_search", "faithfulness_verdict"]},
        "system_prompt_id": prompt_id,
        "history": history,
        "original_answer": original_answer,
        "revised": bool(revision_span),
        "audit_message": audit_message,
        "final_answer": final_answer,
        "tools": tools,
        "timeline": timeline,
        "faithfulness": faithfulness,
        "rubrics": rubrics,
        "rubric_latest": latest,
        "scoring": {"status": status, "attempts": attempts, "errors": dict(errors)},
    }
    summary = {k: detail[k] for k in ["id", "batch", "profile", "persona", "question", "created", "revised", "rubric_latest", "scoring"]}
    summary["prior_turns"] = len(history)
    summary["tool_calls"] = len(tools)
    summary["faithfulness"] = faithfulness[-1] if faithfulness else None
    if summary["faithfulness"]:
        summary["faithfulness"] = {k: summary["faithfulness"][k] for k in ["score", "verdict"]}
    return detail, summary


def faithfulness_template(spans):
    """The faithfulness judge prompt = the shared prefix of every filled-in judge prompt."""
    filled = []
    for s in spans:
        if name(s) == "openai.responses.create" and isinstance(s.get("input"), list) and s["input"]:
            c = s["input"][0].get("content")
            if isinstance(c, str) and "auditing" in c[:200]:
                filled.append(c)
    if not filled:
        return None
    prefix = os.path.commonprefix(filled)
    return prefix[: prefix.rfind("\n")].rstrip() if "\n" in prefix else prefix


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cached", action="store_true", help="reuse the last download instead of calling Braintrust")
    args = ap.parse_args()

    rows = load_rows(args.cached)
    traces = defaultdict(list)
    for e in rows:
        traces[e["root_span_id"]].append(e)
    roots = [e for e in rows if name(e) == "qa" and e["span_id"] == e["root_span_id"]]

    os.makedirs(os.path.join(OUT, "answers"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "answers")):
        os.remove(os.path.join(OUT, "answers", f))

    prompt_ids, summaries, warnings = {}, [], []
    skipped = Counter()
    for root in sorted(roots, key=lambda r: r["created"]):
        detail, summary = build_answer(root, traces[root["root_span_id"]], prompt_ids)
        # Only answers asked within a conversation (prior turns) are reviewed; cold questions are dropped.
        if not summary["prior_turns"]:
            skipped[summary["batch"]] += 1
            continue
        cited = {t for runs in detail["rubrics"].values() for r in runs if r["ok"] for t in r["flagged_turns"]}
        if cited and max(cited) > len(detail["timeline"]):
            warnings.append(f"{detail['id']}: judge cites turn {max(cited)} but timeline has {len(detail['timeline'])} turns")
        with open(os.path.join(OUT, "answers", detail["id"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False)
        summaries.append(summary)

    batches = {}
    for s in summaries:
        b = batches.setdefault(s["batch"], {"id": s["batch"], "answers": 0, "scored": 0, "first": s["created"], "last": s["created"]})
        b["answers"] += 1
        b["scored"] += s["scoring"]["status"] == "scored"
        b["first"], b["last"] = min(b["first"], s["created"]), max(b["last"], s["created"])
    for p in list(prompt_ids.values()):
        p["batches"] &= batches.keys()
        if not p["batches"]:
            del prompt_ids[p["id"]]
    for b in batches.values():
        b["prompt_ids"] = sorted(p["id"] for p in prompt_ids.values() if b["id"] in p["batches"])

    profiles = sorted({(s["profile"]["n"], s["profile"]["label"]) for s in summaries})
    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": f"Braintrust project {PROJECT!r}",
        "rubrics": RUBRICS,
        "batches": sorted(batches.values(), key=lambda b: b["last"], reverse=True),
        "profiles": [{"n": n, "label": l} for n, l in profiles],
        "answers": summaries,
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)

    judge_prompts = {}
    for r in RUBRICS:
        path = os.path.join(JUDGE_PROMPT_DIR, r["key"] + ".md")
        judge_prompts[r["key"]] = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    prompts = {
        "assistant": sorted(({**p, "batches": sorted(p["batches"])} for p in prompt_ids.values()), key=lambda p: p["first_seen"]),
        "faithfulness_judge": faithfulness_template(rows),
        "rubric_judges": judge_prompts,
    }
    with open(os.path.join(OUT, "prompts.json"), "w", encoding="utf-8") as f:
        json.dump(prompts, f, ensure_ascii=False)

    status = Counter(s["scoring"]["status"] for s in summaries)
    errs = Counter()
    for s in summaries:
        errs.update(s["scoring"]["errors"])
    print(f"{len(summaries)} answers in {len(batches)} batches · scoring: {dict(status)}")
    if skipped:
        print(f"Dropped {sum(skipped.values())} answers with no conversation history:", dict(skipped))
    if errs:
        print("Rubric judge failures:", dict(errs))
    print(f"{len(prompt_ids)} assistant system prompt(s); rubric judge prompts loaded: "
          f"{sum(v is not None for v in judge_prompts.values())}/{len(RUBRICS)}")
    for w in warnings:
        print("WARNING", w)


if __name__ == "__main__":
    main()
