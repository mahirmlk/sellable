"""Entry point for running eval scenarios as a module."""

from evals.runner.scenario_runner import print_report, run_all

if __name__ == "__main__":
    results = run_all()
    print_report(results)
    failed = [r for r in results if not r.passed]
    raise SystemExit(1 if failed else 0)
