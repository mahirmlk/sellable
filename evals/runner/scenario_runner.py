"""Eval scenario runner — executes deterministic scenarios against the commerce core."""

from __future__ import annotations

import importlib
import time
from dataclasses import dataclass, field
from pathlib import Path

_SCENARIO_DIR = Path(__file__).resolve().parent.parent / "scenarios"


@dataclass
class ScenarioResult:
    scenario: str
    passed: bool
    duration_ms: float
    error: str | None = None
    details: dict = field(default_factory=dict)


def list_scenarios() -> list[str]:
    """Discover all scenario modules in the scenarios directory."""
    scenarios = []
    for path in sorted(_SCENARIO_DIR.glob("*.py")):
        if path.name.startswith("_"):
            continue
        scenarios.append(path.stem)
    return scenarios


def run_scenario(name: str) -> ScenarioResult:
    """Run a single scenario by module name."""
    start = time.perf_counter()
    try:
        module = importlib.import_module(f"evals.scenarios.{name}")
        result = module.run()
        duration_ms = (time.perf_counter() - start) * 1000
        passed = result.get("passed", False)
        return ScenarioResult(
            scenario=name,
            passed=passed,
            duration_ms=duration_ms,
            details=result,
        )
    except NotImplementedError:
        return ScenarioResult(
            scenario=name,
            passed=False,
            duration_ms=(time.perf_counter() - start) * 1000,
            error="Scenario not implemented",
        )
    except Exception as exc:
        return ScenarioResult(
            scenario=name,
            passed=False,
            duration_ms=(time.perf_counter() - start) * 1000,
            error=str(exc),
        )


def run_all() -> list[ScenarioResult]:
    """Run all discovered scenarios."""
    results = []
    for name in list_scenarios():
        results.append(run_scenario(name))
    return results


def print_report(results: list[ScenarioResult]) -> None:
    """Print a formatted report of scenario results."""
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = total - passed

    print(f"\n{'=' * 60}")
    print(f"  SELLABLE Eval Report — {passed}/{total} passed, {failed} failed")
    print(f"{'=' * 60}\n")

    for r in results:
        status = "PASS" if r.passed else "FAIL"
        print(f"  [{status}] {r.scenario:<30} {r.duration_ms:>8.1f}ms")
        if r.error:
            print(f"           Error: {r.error}")
        if r.details:
            for key, value in r.details.items():
                if key != "passed":
                    print(f"           {key}: {value}")

    print(f"\n{'=' * 60}\n")


if __name__ == "__main__":
    results = run_all()
    print_report(results)
    failed = [r for r in results if not r.passed]
    raise SystemExit(1 if failed else 0)
