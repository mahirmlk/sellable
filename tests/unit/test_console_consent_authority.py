from fastapi.testclient import TestClient

from sellable.merchant_auth import MerchantSession


def test_non_owner_cannot_issue_purchase_consent(monkeypatch):
    import sellable.main as main_module

    app = main_module.app
    app.dependency_overrides[main_module.get_merchant_session] = lambda: MerchantSession(
        merchant_id="mrc_test_owner_gate",
        auth_user_id="user_test_operator",
        role="operator",
    )
    monkeypatch.setattr(
        main_module,
        "merchant_core",
        lambda _session: (_ for _ in ()).throw(
            AssertionError("consent authorization must be checked before core access")
        ),
    )

    try:
        response = TestClient(app).post(
            "/console/orders/ord_test_owner_gate/consent"
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "This action requires the merchant owner role"
    finally:
        app.dependency_overrides.clear()
