"""Record repeatable API/browser acceptance with private raw evidence."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8911")
    parser.add_argument("--capture-guide", action="store_true")
    parser.add_argument("--stage", default="local", choices=("local", "production"))
    parser.add_argument("--api-image", help="Run calculation/API tests in the exact deployed container image")
    args = parser.parse_args()
    os.umask(0o077)
    started = dt.datetime.now(dt.timezone.utc)
    run_id = started.strftime("%Y%m%dT%H%M%S%fZ") + "-" + args.stage
    results = ROOT / "test/web/results" / run_id
    results.mkdir(parents=True, mode=0o700)
    reports = ROOT / "test/web/reports"
    reports.mkdir(parents=True, exist_ok=True, mode=0o755)
    version = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    state = subprocess.check_output(["git", "status", "--short"], cwd=ROOT, text=True).strip()
    commands = [[sys.executable, "-m", "unittest", "discover", "-s", "test/web", "-p", "test_api.py", "-v"], ["node", "test/web/test_browser.cjs"]]
    if args.api_image:
        commands[0] = ["docker", "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp", "--mount", f"type=bind,src={ROOT / 'test'},dst=/app/test,readonly", args.api_image, "python", "-m", "unittest", "discover", "-s", "test/web", "-p", "test_api.py", "-v"]
    env = dict(os.environ, BASE_URL=args.base_url, RESULT_DIR=str(results), CAPTURE_GUIDE="1" if args.capture_guide else "0")
    rows = []
    for name, command in zip(("api", "browser"), commands):
        log = results / (name + ".log")
        with log.open("w") as output:
            result = subprocess.run(command, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT)
        row = {"name": name, "command": shlex.join(command), "exit_code": result.returncode, "status": "PASS" if result.returncode == 0 else "FAIL"}
        rows.append(row)
        print(f"{row['status']} {name}: {log.relative_to(ROOT)}", flush=True)
        if result.returncode:
            print(log.read_text()[-8000:], flush=True)
    finished = dt.datetime.now(dt.timezone.utc)
    paths = [ROOT / "src/backtester.py", ROOT / "src/web_app.py", *sorted((ROOT / "web").rglob("*"))]
    hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}
    manifest = {"started": started.isoformat(), "finished": finished.isoformat(), "base_url": args.base_url, "stage": args.stage, "base_revision": version, "working_tree": state, "python": sys.version, "commands": rows, "artifact_sha256": hashes}
    (results / "run.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    report = reports / (run_id + ".md")
    text = [f"# Web acceptance — {run_id}", "", f"- Started (UTC): {started.isoformat()}", f"- Finished (UTC): {finished.isoformat()}", f"- Working directory: `{ROOT}`", f"- Base revision: `{version}` (working changes below)", f"- Target: `{args.base_url}`", f"- Python: `{sys.version.split()[0]}`", f"- Evidence: `../results/{run_id}/` (private, Git ignored)", "", "| Check | Result | Exit | Command |", "| --- | --- | --- | --- |"]
    text.extend(f"| {r['name']} | {r['status']} | {r['exit_code']} | `{r['command']}` |" for r in rows)
    text += ["", "Covers synthetic calculations, original-engine parity, rebalance targets/cash flows/counters, five-step process, CSV validation/export, error handling, desktop/mobile flows, six-step tour and guide assets. Browser requests use the target URL above. No real market-data accuracy, brokerage execution or independent off-LAN reachability is asserted.", "", "## Working tree", "", "```text", state, "```", "", "Exact source and screenshot SHA-256 values, command output, and browser version evidence are retained in the raw run directory.", ""]
    report.write_text("\n".join(text))
    report.chmod(0o644)
    print(f"Report: {report.relative_to(ROOT)}", flush=True)
    return 1 if any(row["exit_code"] for row in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
