"""Mirror a deployed instance's built data into public/data/.

    python scripts/fetch_deployed_data.py --from https://answer-review.pages.dev \
        --email you@aamrut.com

Braintrust logs expire, so `build_data.py` can only rebuild answers whose
traces are still inside the retention window. A deployed instance has no such
limit: it is already serving the JSON that was built back when those logs
existed. This signs in with the team password and copies that data down, which
is the only way to recover answers whose traces are gone — judge scores
included, since those were written into the build rather than re-read from
Braintrust each time.

The password never goes on the command line, because arguments are visible to
anyone who can list processes. It is read from, in order:
  the TEAM_PASSWORD environment variable
  --password-file <path>   (default: ~/.aamrut-team-pw)
  an interactive prompt

Transport is `curl`, not urllib. Cloudflare's browser-integrity check rejects
Python's default client with its own 403 ("error code: 1010"), which looks
exactly like a failed sign-in until you read the body. curl is not disguised
as anything — it simply isn't on the block list. If a deployment blocks curl
too, allow it in the Cloudflare dashboard rather than dressing this up as a
browser.

This only reads; nothing is uploaded and nothing on the remote changes. Local
files under public/data/ ARE overwritten, so copy them first if they matter.
Reviewer flags and edits are not here at all — they live in that deployment's
D1 database, and come across only by deploying to the same project or by
exporting that database separately.
"""
import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "data")
TIMEOUT_S = 90


class Remote:
    """A signed-in, cookie-carrying client for one deployment."""

    def __init__(self, base):
        if not shutil.which("curl"):
            sys.exit("curl is required — see the note about Cloudflare in this file's docstring.")
        self.base = base.rstrip("/")
        self.jar = tempfile.mkstemp(prefix="aq-session-")[1]

    def close(self):
        """The jar holds a live session cookie; don't leave it on disk."""
        try:
            os.remove(self.jar)
        except OSError:
            pass

    def _run(self, args, stdin=None):
        """Returns (body_bytes, status). curl appends the status on its own line."""
        proc = subprocess.run(
            ["curl", "-sS", "--max-time", str(TIMEOUT_S), *args, "-w", "\n%{http_code}"],
            input=stdin, capture_output=True, timeout=TIMEOUT_S + 30)
        if proc.returncode != 0:
            sys.exit(f"curl failed: {proc.stderr.decode('utf-8', 'replace').strip()}")
        body, _, status = proc.stdout.rpartition(b"\n")
        return body, status.decode().strip()

    def sign_in(self, email, password):
        body, status = self._run(
            ["-c", self.jar, "-X", "POST", f"{self.base}/api/auth/password",
             "-H", "Content-Type: application/json", "--data-binary", "@-"],
            stdin=json.dumps({"email": email, "password": password}).encode())
        if status == "200":
            return
        text = body.decode("utf-8", "replace")
        if "error code" in text or "1010" in text:
            sys.exit(f"Blocked by the site's bot protection, not by sign-in (HTTP {status}).\n"
                     "Allow this client in Cloudflare rather than disguising it as a browser.")
        try:
            detail = json.loads(text).get("error", "")
        except ValueError:
            detail = text.strip()[:200]
        sys.exit(f"Sign-in failed (HTTP {status}){': ' + detail if detail else ''}")

    def get(self, path):
        body, status = self._run(["-b", self.jar, f"{self.base}{path}"])
        if status != "200":
            raise FileNotFoundError(f"HTTP {status}")
        return body

    def save(self, path, dest):
        body = self.get(path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(body)
        return len(body)


def read_password(path):
    if os.environ.get("TEAM_PASSWORD"):
        return os.environ["TEAM_PASSWORD"]
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    return getpass.getpass("Team password: ")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="base", required=True,
                    help="deployed instance, e.g. https://answer-review.pages.dev")
    ap.add_argument("--email", required=True, help="your work email, for sign-in")
    ap.add_argument("--password-file", default=os.path.expanduser("~/.aamrut-team-pw"))
    ap.add_argument("--skip-patients", action="store_true",
                    help="leave public/data/patients* alone. Use this when the local build is "
                         "newer than the deployment's — build_profiles.py now emits a `folder` "
                         "field that older builds lack and the assistant needs.")
    args = ap.parse_args()

    remote = Remote(args.base)
    try:
        remote.sign_in(args.email, read_password(args.password_file))
        print(f"Signed in to {remote.base}\n")

        index = json.loads(remote.get("/data/index.json"))
        answers = index.get("answers", [])
        scored = sum(1 for a in answers if a.get("rubric_latest"))
        print(f"  index.json: {len(answers)} answers, {len(index.get('batches', []))} batches, "
              f"{scored} with judge scores")

        total = remote.save("/data/index.json", os.path.join(OUT, "index.json"))
        names = ["prompts.json"] + ([] if args.skip_patients else ["patients.json"])
        for name in names:
            try:
                total += remote.save(f"/data/{name}", os.path.join(OUT, name))
                print(f"  {name}")
            except FileNotFoundError as e:
                print(f"  {name}: {e} (skipped)")

        if not args.skip_patients:
            for p in index.get("profiles", []):
                try:
                    total += remote.save(f"/data/patients/{p['n']}.json",
                                         os.path.join(OUT, "patients", f"{p['n']}.json"))
                except FileNotFoundError as e:
                    print(f"  patients/{p['n']}.json: {e} (skipped)")

        missing = 0
        for i, a in enumerate(answers, 1):
            try:
                total += remote.save(f"/data/answers/{a['id']}.json",
                                     os.path.join(OUT, "answers", f"{a['id']}.json"))
            except FileNotFoundError as e:
                missing += 1
                print(f"  answers/{a['id']}.json: {e}")
            if i % 20 == 0 or i == len(answers):
                print(f"  answers {i}/{len(answers)}")

        print(f"\nDone: {total / 1e6:.1f} MB into {OUT}"
              + (f" ({missing} answer file(s) missing)" if missing else ""))
        print("Reviewer flags and edits are NOT here — they live in that deployment's D1.")
    finally:
        remote.close()


if __name__ == "__main__":
    main()
