"""Run the real evaluation battery end to end (target §30).

One command that executes everything the evaluation platform defines:

1. All versioned harness suites (§30.2) against isolated cores, with the
   configured LLM provider in the loop and run/model telemetry persisted.
2. The §30.6 regression gates over the recorded suite reports.
3. The deterministic scenario runner (evals/scenarios).

Usage:  python -m evals.run_all [--no-llm] [--json]

``--no-llm`` forces the mock adapter (SELLABLE_LLM_FORCED_MOCK), which is
how CI runs; the default uses whatever provider the environment configures.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _load_dotenv() -> None:
    """Load the repo .env (config does not, by design, for library use)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    root = Path(__file__).resolve().parent.parent
    if (root / ".env").is_file():
        load_dotenv(root / ".env")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-llm", action="store_true", help="Force the mock adapter")
    parser.add_argument("--json", action="store_true", help="Emit a JSON summary")
    args = parser.parse_args()

    _load_dotenv()
    if args.no_llm:
        os.environ["LLM_PROVIDER"] = "mock"

    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from evals.datasets.v1 import SUITES
    from evals.regression.gates import check_gates
    from evals.runner.harness import EVAL_MODEL_CALLS, EvaluationHarness, SuiteReport
    from evals.runner.scenario_runner import print_report, run_all
    from sellable.config import settings
    from sellable.core import CommerceCore
    from sellable.ledger.database import Base
    from sellable.ledger.service import LedgerRepository
    from sellable.repositories import EvaluationRepository

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    def factory() -> CommerceCore:
        case_engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(case_engine)
        return CommerceCore.from_seed(LedgerRepository(case_engine), engine=case_engine)

    harness = EvaluationHarness(
        EvaluationRepository(engine=engine), engine=engine
    )

    model_label = f"{settings.llm_provider}/{settings.llm_model or 'default'}"
    if settings.llm_provider in ("mock", "deterministic", ""):
        model_label = "mock (deterministic)"

    print(f"SELLABLE real evals — model: {model_label}")
    print("=" * 72)

    reports: list[SuiteReport] = []
    for suite_id in SUITES:
        report = harness.run_suite(
            factory,
            suite_id,
            agent_id="eval-battery",
            agent_version="core-v2",
            model=model_label,
        )
        reports.append(report)
        failed_cases = [r for r in report.results if not r.passed]
        status = "PASS" if not failed_cases else "FAIL"
        print(
            f"[{status}] {suite_id}: {report.passed}/{report.passed + report.failed}"
            f" in {report.duration_ms}ms"
        )
        for case in failed_cases:
            print(
                f"       ✗ {case.case_id} ({case.severity}) err={case.error} "
                f"details={json.dumps(case.details, default=str)[:400]}"
            )

    print("-" * 72)
    gate = check_gates(reports)
    print(
        f"Gates: {'PASS' if gate.passed else 'FAIL'} — {json.dumps(gate.metrics)}"
    )
    for failure in gate.failures:
        print(f"       ✗ {failure}")

    model_calls = len(EVAL_MODEL_CALLS)
    total_cost = round(sum(r.estimated_cost_usd for r in EVAL_MODEL_CALLS), 6)
    print(f"Model calls recorded: {model_calls} (est. cost ${total_cost})")

    print("-" * 72)
    print("Scenarios:")
    scenario_results = run_all()
    print_report(scenario_results)
    scenario_failures = [r for r in scenario_results if not r.passed]

    if args.json:
        print(
            json.dumps(
                {
                    "model": model_label,
                    "model_calls": model_calls,
                    "gates": {
                        "passed": gate.passed,
                        "failures": gate.failures,
                        "metrics": gate.metrics,
                    },
                    "suites": [
                        {
                            "suite_id": r.suite_id,
                            "run_id": r.run_id,
                            "passed": r.passed,
                            "failed": r.failed,
                            "duration_ms": r.duration_ms,
                            "cost_usd": r.cost_usd,
                            "failed_cases": [
                                {
                                    "case_id": c.case_id,
                                    "severity": c.severity,
                                    "error": c.error,
                                    "details": c.details,
                                }
                                for c in r.results
                                if not c.passed
                            ],
                        }
                        for r in reports
                    ],
                    "scenarios": [
                        {
                            "scenario": r.scenario,
                            "passed": r.passed,
                            "error": r.error,
                        }
                        for r in scenario_results
                    ],
                },
                indent=2,
                default=str,
            )
        )

    ok = gate.passed and not scenario_failures
    print("=" * 72)
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
