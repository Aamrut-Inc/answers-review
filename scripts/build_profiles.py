"""Builds the patient profiles shown on each patient's page.

    python scripts/build_profiles.py

Sources:
    profile_source/chart_qa/   snapshot of Chart QA's per-patient data (patients.json,
                               <folder>/index.json, content.json, wearable.json)
    ../11-All_Profiles_Persona_Conversations_Extended/<n>-*/00_grounding_brief.md
                               the grounding text the simulated patient was given

Outputs:
    public/data/patients.json        one card per patient
    public/data/patients/<n>.json    the full, condensed profile
"""
import glob
import json
import os
import re
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "profile_source", "chart_qa")
BRIEFS = os.path.join(os.path.dirname(ROOT), "11-All_Profiles_Persona_Conversations_Extended")
OUT = os.path.join(ROOT, "public", "data")

# Same choices as Chart QA's Patient Review screen.
VITALS_PRIORITY = ["33914-3", "4548-4", "2160-0", "39156-5", "8867-4", "8480-6", "8462-4", "3016-3"]
EXCLUDE_CODES = {"8302-2", "40443-4", "41950-7", "sleep_duration", "sleep_efficiency"}
EXCLUDE_WORDS = ["height", "temperature", "steps in 24 hour", "--resting"]
REFERENCE_BANDS = {
    "33914-3": {"low": 30, "high": 59, "label": "CKD Stage 3 band"},
    "4548-4": {"low": 4.0, "high": 5.6, "label": "Non-diabetic range"},
    "3016-3": {"low": 0.4, "high": 4.0, "label": "Typical reference range"},
}
WEARABLES = [
    ("steps", "Daily steps", ""),
    ("resting_hr", "Resting heart rate", "bpm"),
    ("rmssd", "Heart rate variability", "ms"),
    ("spo2", "Blood oxygen (SpO₂)", "%"),
    ("sleep_duration_hrs", "Sleep duration", "h"),
    ("sleep_efficiency", "Sleep efficiency", "%"),
    ("stress_score", "Stress score", ""),
    ("very_active_minutes", "Vigorous activity", "min"),
    ("sedentary_minutes", "Sedentary time", "min"),
]
FRIENDLY = {
    "33914-3": "eGFR", "2160-0": "Creatinine", "4548-4": "HbA1c", "39156-5": "BMI", "8867-4": "Heart rate",
    "8480-6": "Systolic BP", "8462-4": "Diastolic BP", "3016-3": "TSH", "14959-1": "Urine albumin/creatinine",
    "29463-7": "Body weight", "2093-3": "Total cholesterol", "2571-8": "Triglycerides", "18262-6": "LDL cholesterol",
    "2085-9": "HDL cholesterol", "2339-0": "Glucose", "9279-1": "Respiratory rate", "72514-3": "Pain score",
    "718-7": "Hemoglobin", "6299-2": "Urea nitrogen", "2947-0": "Sodium", "6298-4": "Potassium",
}
KEY_NUMBERS_MAX = 8
SERIES_MAX = 60


def clean_label(label):
    return re.sub(r"\s*\((disorder|finding|situation|morphologic abnormality|procedure)\)\s*$", "", label or "", flags=re.I)


def short_label(code, label):
    if code in FRIENDLY:
        return FRIENDLY[code]
    s = clean_label(label)
    s = re.sub(r"\s*\[[^\]]*\]", "", s)
    urine = " in Urine" in s
    s = re.sub(r"\s+(in|by)\s+(Serum|Plasma|Blood|Urine|Body|Test strip|Automated).*$", "", s)
    return s.strip() + (" (urine)" if urine else "")


def clean_unit(u):
    if not u:
        return ""
    if u == "mL/min/{1.73_m2}":
        return "mL/min/1.73m²"
    return re.sub(r"\{[^}]*\}", "", u).strip()


def split_drug_dose(text):
    """'24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet' -> drug, dose."""
    if text.strip().startswith("{"):
        # Multi-part packs ("{ 24 (drospirenone 3 MG / ...) } Pack [Yaz 28 Day]"): use the brand name.
        brand = re.search(r"\[([^\]]+)\]\s*$", text)
        inner = re.search(r"\(([A-Za-z][A-Za-z ]+?)\s+[\d.]", text)
        name = brand.group(1) if brand else (inner.group(1) if inner else "Combination pack")
        return name, re.sub(r"\s*\[[^\]]+\]\s*$", "", text).strip()
    s, prefix = text, ""
    while True:
        m = re.match(r"^([A-Z]{2,}\d{3,}|\d+(\.\d+)?\s*(HR|ACTUAT|ML))\s+", s)
        if not m:
            break
        prefix += m.group(0)
        s = s[len(m.group(0)):]
    d = re.search(r"\d", s)
    if not d:
        return text.strip(), ""
    drug = s[: d.start()].strip()
    return (drug or text.strip()), (prefix + s[d.start():]).strip()


def year(iso):
    return iso[:4] if iso else None


def since(iso, as_of):
    if not iso:
        return None
    y1, m1 = int(iso[:4]), int(iso[5:7])
    y2, m2 = int(as_of[:4]), int(as_of[5:7])
    months = (y2 - y1) * 12 + (m2 - m1)
    if months < 1:
        return "new"
    if months < 12:
        return f"{months} mo"
    return f"{months // 12}y" + (f" {months % 12}mo" if months % 12 else "")


def downsample(points, n=SERIES_MAX):
    if len(points) <= n:
        return points
    step = (len(points) - 1) / (n - 1)
    return [points[round(i * step)] for i in range(n)]


def num(v):
    return round(v, 2) if isinstance(v, float) else v


def brief_text(n):
    hits = glob.glob(os.path.join(BRIEFS, f"{n}-*", "00_grounding_brief.md"))
    if not hits:
        return None
    text = open(hits[0], encoding="utf-8").read()
    m = re.search(r"## Patient grounding text[^\n]*\n(.*)", text, re.S)
    return m.group(1).strip() if m else None


def build(patient):
    folder = patient["folder"]
    n = int(re.match(r"\s*(\d+)", folder).group(1))
    index = json.load(open(os.path.join(SRC, folder, "index.json"), encoding="utf-8"))
    content = json.load(open(os.path.join(SRC, folder, "content.json"), encoding="utf-8"))
    wearable = json.load(open(os.path.join(SRC, folder, "wearable.json"), encoding="utf-8"))

    as_of = max((r["date"] for b in index["biomarkers"] for r in b.get("readings") or [] if r.get("date")), default="2026-07-01")

    # ---- Conditions ----
    primary_codes = content.get("primary_conditions") or []
    extra = content.get("conditions_extra") or {}
    open_conds = [c for c in index["conditions"] if c.get("abatement") is None]
    primary = []
    for code in primary_codes:
        c = next((x for x in open_conds if x["code"] == code), None)
        if not c:
            continue
        e = extra.get(code) or {}
        primary.append({"label": clean_label(c["label"]), "since": year(c.get("onset")),
                        "diagnosed": e.get("diagnosed_label"), "pathway": e.get("pathway")})
    other = sorted(({"label": clean_label(c["label"]), "since": year(c.get("onset"))}
                    for c in open_conds if c["code"] not in primary_codes), key=lambda c: c["since"] or "")
    resolved = len(index["conditions"]) - len(open_conds)

    # ---- Medications ----
    by_text = {m["text"]: m for m in index["medications"]}
    groups, used = [], set()
    def med_row(m):
        drug, dose = split_drug_dose(m["text"])
        return {"drug": drug, "dose": dose, "frequency": m.get("dosage"), "as_needed": bool(m.get("as_needed")),
                "since": (m.get("first_authored") or "")[:10] or None, "for": since(m.get("first_authored"), as_of),
                "status": m.get("status")}
    for g in content.get("medication_groups") or []:
        meds = [by_text[t] for t in g["codes"] if t in by_text]
        used.update(m["text"] for m in meds)
        if meds:
            groups.append({"label": g["label"], "meds": [med_row(m) for m in meds]})
    rest = [m for m in index["medications"] if m["text"] not in used]
    if rest:
        groups.append({"label": "Other" if groups else "Medications", "meds": [med_row(m) for m in rest]})

    # ---- Clinical numbers ----
    def excluded(b):
        l = (b.get("label") or "").lower()
        return b["code"] in EXCLUDE_CODES or any(w in l for w in EXCLUDE_WORDS)
    eligible = {b["code"]: b for b in index["biomarkers"] if not excluded(b) and b.get("latest")}
    relevant = []
    for e in extra.values():
        relevant += e.get("relevant_biomarker_codes") or []
    order = list(dict.fromkeys(relevant + VITALS_PRIORITY))
    key_codes = [c for c in order if c in eligible][:KEY_NUMBERS_MAX]
    key_numbers = []
    for code in key_codes:
        b = eligible[code]
        readings = [{"d": r["date"][:10], "v": num(r["value"])} for r in b.get("readings") or [] if isinstance(r.get("value"), (int, float))]
        vals = [r["v"] for r in readings]
        key_numbers.append({
            "code": code, "label": short_label(code, b["label"]), "full_label": clean_label(b["label"]), "unit": clean_unit(b.get("unit")),
            "latest": {"d": b["latest"]["date"][:10], "v": num(b["latest"]["value"])},
            "first": readings[0] if readings else None,
            "count": b.get("reading_count") or len(readings),
            "min": min(vals) if vals else None, "max": max(vals) if vals else None,
            "band": REFERENCE_BANDS.get(code), "relevant": code in relevant,
            "series": downsample(readings),
        })
    other_numbers = sorted(({"label": short_label(c, b["label"]), "full_label": clean_label(b["label"]), "unit": clean_unit(b.get("unit")),
                             "v": num(b["latest"]["value"]), "d": b["latest"]["date"][:10], "count": b.get("reading_count")}
                            for c, b in eligible.items() if c not in key_codes), key=lambda x: (x["label"], -(x["count"] or 0)))
    # Blood and serum versions of the same test read the same to a reviewer: keep the better-sampled one.
    seen = set()
    other_numbers = [o for o in other_numbers if not (o["label"] in seen or seen.add(o["label"]))]
    findings = [{"label": clean_label(q["label"]), "v": clean_label(str(q["latest"]["value"])), "d": q["latest"]["date"][:10]}
                for q in index.get("qualitative_observations") or [] if q.get("latest")]

    # ---- Wearables ----
    daily = wearable.get("daily") or []
    relevance = content.get("wearable_relevance") or {}
    wear = []
    for key, label, unit in WEARABLES:
        def val(d):
            if key == "sleep_duration_hrs":
                return d["sleep_duration"] / 3600000 if d.get("sleep_duration") is not None else None
            return d.get(key)
        series = [{"d": d["date"], "v": num(val(d))} for d in daily]
        vals = [p["v"] for p in series if isinstance(p["v"], (int, float))]
        wear.append({
            "key": key, "label": label, "unit": unit,
            "avg": round(statistics.mean(vals), 1) if vals else None,
            "sd": round(statistics.stdev(vals), 1) if len(vals) > 1 else None,
            "days": len(vals), "relevance": relevance.get(key.replace("_hrs", "")),
            "series": series if vals else [],
        })
    dates = [d["date"] for d in daily]

    enc = index.get("encounters") or {}
    return {
        "n": n,
        "name": patient["name"],
        "age_sex": patient["age_sex"],
        "tag": patient["condition_tag"],
        "narrative": content.get("narrative") or [],
        "grounding": brief_text(n),
        "conditions": {"primary": primary, "other": other, "resolved": resolved},
        "medications": groups,
        "allergies": [clean_label(a.get("label") or a.get("text") or str(a)) for a in index.get("allergies") or []],
        "key_numbers": key_numbers,
        "other_numbers": other_numbers,
        "findings": findings,
        "wearables": {"from": min(dates) if dates else None, "to": max(dates) if dates else None, "features": wear},
        "encounters": {"total": enc.get("total"), "recent": [
            {"date": e["start"][:10], "type": clean_label(e.get("type")), "location": (e.get("location") or "").title()}
            for e in (enc.get("recent") or [])[:5]]},
        "as_of": as_of[:10],
    }


def main():
    patients = json.load(open(os.path.join(SRC, "patients.json"), encoding="utf-8"))
    os.makedirs(os.path.join(OUT, "patients"), exist_ok=True)
    cards = []
    for p in patients:
        prof = build(p)
        with open(os.path.join(OUT, "patients", f"{prof['n']}.json"), "w", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False)
        cards.append({
            "n": prof["n"], "name": prof["name"], "age_sex": prof["age_sex"], "tag": prof["tag"],
            "summary": prof["narrative"][0] if prof["narrative"] else "",
            "conditions": [c["label"] for c in prof["conditions"]["primary"]][:3],
            "condition_count": len(prof["conditions"]["primary"]) + len(prof["conditions"]["other"]),
            "medication_count": sum(len(g["meds"]) for g in prof["medications"]),
        })
        print(f"{prof['n']} {prof['name']:<16} conditions {cards[-1]['condition_count']:>2} · meds {cards[-1]['medication_count']:>2} · "
              f"key numbers {len(prof['key_numbers'])} · grounding {'yes' if prof['grounding'] else 'no'}")
    with open(os.path.join(OUT, "patients.json"), "w", encoding="utf-8") as f:
        json.dump(sorted(cards, key=lambda c: c["n"]), f, ensure_ascii=False)


if __name__ == "__main__":
    main()
