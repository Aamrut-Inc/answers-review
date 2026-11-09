"""Pull Chart QA's per-patient data into this repo, reproducibly.

    python scripts/sync_chart_data.py --from ../patient-review/data

Until now `profile_source/chart_qa/` was a hand-copied snapshot of Chart QA's
output: nobody could tell which commit it came from, and refreshing it meant
remembering to copy files. This makes it a build step.

Two destinations, because two consumers want different things:

  profile_source/chart_qa/          what build_profiles.py reads, to produce
                                    the condensed profile each patient page shows
  public/data/chart/<folder>/       what the assistant reads in the browser —
                                    the full index/content/wearable/record

`record.json` is the big one (1.4 MB for CKD) and is only needed by the
assistant, so it is written only to public/data/.
"""
import argparse
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# What build_profiles.py reads, and what the assistant reads in the browser.
PROFILE_FILES = ("index.json", "content.json", "wearable.json")
ASSISTANT_FILES = ("index.json", "content.json", "wearable.json", "record.json")


def human(n):
    return f"{n / 1e6:.1f} MB" if n >= 1e6 else f"{n / 1e3:.0f} KB"


def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    return os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", default="../patient-review/data",
                    help="Chart QA's data/ directory (default: ../patient-review/data)")
    ap.add_argument("--skip-assistant", action="store_true",
                    help="only refresh profile_source/, skipping the large record.json copies")
    args = ap.parse_args()

    src = os.path.abspath(os.path.join(ROOT, args.src)) if not os.path.isabs(args.src) else args.src
    manifest = os.path.join(src, "patients.json")
    if not os.path.exists(manifest):
        sys.exit(f"No patients.json under {src}\n"
                 f"Point --from at Chart QA's data/ directory.")

    patients = json.load(open(manifest, encoding="utf-8"))
    profile_dir = os.path.join(ROOT, "profile_source", "chart_qa")
    public_dir = os.path.join(ROOT, "public", "data", "chart")
    os.makedirs(profile_dir, exist_ok=True)
    copy(manifest, os.path.join(profile_dir, "patients.json"))

    total, missing = 0, []
    for p in patients:
        folder = p["folder"]
        for name in PROFILE_FILES:
            s = os.path.join(src, folder, name)
            if not os.path.exists(s):
                missing.append(f"{folder}/{name}")
                continue
            total += copy(s, os.path.join(profile_dir, folder, name))

        if args.skip_assistant:
            continue
        for name in ASSISTANT_FILES:
            s = os.path.join(src, folder, name)
            if not os.path.exists(s):
                if f"{folder}/{name}" not in missing:
                    missing.append(f"{folder}/{name}")
                continue
            total += copy(s, os.path.join(public_dir, folder, name))

        sizes = {n: os.path.getsize(os.path.join(src, folder, n))
                 for n in ASSISTANT_FILES if os.path.exists(os.path.join(src, folder, n))}
        print(f"  {p['n'] if 'n' in p else '':>2} {folder:<22} " +
              " ".join(f"{n.split('.')[0]}={human(v)}" for n, v in sizes.items()))

    print(f"\n{len(patients)} patients, {human(total)} copied")
    print(f"  profile_source/chart_qa/   -> build_profiles.py")
    if not args.skip_assistant:
        print(f"  public/data/chart/         -> the assistant, in the browser")
    if missing:
        # Not fatal: record.json only exists once build_agent_records.py has run,
        # and a patient without one simply has no assistant context.
        print(f"\n  {len(missing)} file(s) not found in the source:")
        for m in missing[:12]:
            print(f"    {m}")


if __name__ == "__main__":
    main()
