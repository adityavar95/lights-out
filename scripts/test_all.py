"""Run every test suite: tests/*.mjs with node, then tests/test_server.py. Runs them all, then exits 1 if any failed."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    suites = [["node", str(p)] for p in sorted((ROOT / "tests").glob("test_*.mjs"))]
    suites.append([sys.executable, str(ROOT / "tests" / "test_server.py")])
    failed = []
    for cmd in suites:
        name = Path(cmd[-1]).name
        result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        print(f"{'ok  ' if result.returncode == 0 else 'FAIL'} {name}")
        if result.returncode != 0:
            print(result.stdout[-2000:], result.stderr[-2000:], sep="\n")
            failed.append(name)
    if failed:
        print(f"{len(failed)} failed: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
