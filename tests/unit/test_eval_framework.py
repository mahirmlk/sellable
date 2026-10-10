"""Phase 7: versioned datasets, harness persistence, gates, and drift."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from evals.datasets.v1 import SUITES
from evals.drift import collect_production_stats, compare
from evals.regression.gates import check_gates
from evals.runner.harness import EvaluationHarness
from sellable.core import CommerceCore
from sellable.ledger.database import Base
from sellable.ledger.service import LedgerRepository
from sellable.repositories import EvaluationRepository


@pytest.fixture
def eval_env():
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

    repo = EvaluationRepository(engine=engine)
    return EvaluationHarness(repo, engine=engine), factory, repo


def test_datasets_registered() -> None:
    assert set(SUITES) == {
        "seller-commerce-v1",
        "seller-safety-v1",
        "cs-support-v1",
        "adversarial-v1",
        "invariants-v1",
    }
    total = sum(len(spec.cases) for spec in SUITES.values())
    assert total == 7 + 5 + 5 + 12 + 6


def test_sync_is_idempotent(eval_env) -> None:
    harness, _, repo = eval_env
    first = harness.sync_all()
    second = harness.sync_all()
    assert first == second
    assert len(repo.list_suites()) == 5
    assert len(repo.cases_for_suite("adversarial-v1")) == 12


def test_full_battery_passes_on_current_code(eval_env) -> None:
    harness, factory, repo = eval_env
    reports = [harness.run_suite(factory, suite_id) for suite_id in SUITES]
    for report in reports:
        assert report.failed == 0, (report.suite_id, [r.case_id for r in report.results if not r.passed])
    assert sum(r.passed for r in reports) == 35
    # Persistence round-trips.
    for report in reports:
        stored = repo.results_for_run(report.run_id)
        assert len(stored) == len(report.results)
        assert all(r["passed"] for r in stored)
    latest = repo.latest_run_for_suite("invariants-v1")
    assert latest is not None
    assert latest["passed"] == 6


def test_release_gates_pass(eval_env) -> None:
    harness, factory, _ = eval_env
    reports = [harness.run_suite(factory, suite_id) for suite_id in SUITES]
    gate = check_gates(reports)
    assert gate.passed, gate.failures
    assert gate.metrics["safety_p0_pass_rate"] == 1.0
    assert gate.metrics["commerce_p0_pass_rate"] == 1.0
    assert gate.metrics["p0_failures"] == 0


def test_gates_catch_regressions() -> None:
    from evals.runner.harness import CaseReport, SuiteReport

    bad = SuiteReport(
        suite_id="adversarial-v1",
        run_id="run_bad",
        results=[
            CaseReport(
                case_id="adv_x", category="adversarial", severity="P0",
                passed=False, duration_ms=10,
            ),
            CaseReport(
                case_id="adv_y", category="adversarial", severity="P0",
                passed=True, duration_ms=10,
            ),
        ],
    )
    bad.passed, bad.failed = 1, 1
    gate = check_gates([bad])
    assert not gate.passed
    assert any("safety P0" in f for f in gate.failures)
    assert any("P0 failures" in f for f in gate.failures)


def test_drift_compare_and_collector(eval_env) -> None:
    harness, factory, _ = eval_env
    core = factory()
    from sellable.repositories import AnalyticsRepository, ObservabilityRepository

    stats = collect_production_stats(
        ledger=core.ledger,
        observability_repo=ObservabilityRepository(engine=core.outbox_repo._engine),
        analytics_repo=AnalyticsRepository(engine=core.outbox_repo._engine),
        merchant_id=core.merchant_scope,
        days=7,
    )
    assert set(stats) == {
        "tool_error_rate",
        "policy_denial_rate",
        "conversion_rate_bps",
        "cost_per_run_usd",
        "fraud_rate",
        "support_resolution_rate",
    }
    steady = compare(stats, dict(stats))
    assert not steady.drifted
    regressed = dict(stats, tool_error_rate=0.9)
    drifted = compare(stats, regressed)
    assert drifted.drifted
    assert any(m.metric == "tool_error_rate" and m.drifted for m in drifted.metrics)


def test_console_eval_endpoints() -> None:
    import sellable.main as main_module
    from fastapi.testclient import TestClient

    from sellable import merchant_auth

    session = merchant_auth.MerchantSession(
        merchant_id="mrc_demo_store", role="owner", auth_user_id="user_eval"
    )
    user = merchant_auth.AuthenticatedUser(auth_user_id="user_eval")
    main_module.app.dependency_overrides[
        merchant_auth.get_merchant_session
    ] = lambda: session
    main_module.app.dependency_overrides[
        merchant_auth.get_authenticated_user
    ] = lambda: user
    client = TestClient(main_module.app)
    try:
        suites = client.get("/console/evals/suites")
        assert suites.status_code == 200, suites.text
        assert {s["suite_id"] for s in suites.json()} == set(SUITES)

        run = client.post("/console/evals/suites/invariants-v1/run")
        assert run.status_code == 200, run.text
        assert run.json()["failed"] == 0
        assert run.json()["passed"] == 6

        detail = client.get(f"/console/evals/runs/{run.json()['run_id']}")
        assert detail.status_code == 200
        assert len(detail.json()["results"]) == 6

        missing = client.get("/console/evals/runs/evalrun_missing")
        assert missing.status_code == 404

        unknown = client.post("/console/evals/suites/nope/run")
        assert unknown.status_code == 404

        drift = client.get(
            "/console/evals/drift", params={"days": 7, "baseline_days": 7}
        )
        assert drift.status_code == 200, drift.text
        assert "metrics" in drift.json()
    finally:
        main_module.app.dependency_overrides.clear()
        client.close()
