# Razorpay Test-Mode and Webhook Setup

SELLABLE accepts only Razorpay test-mode credentials. Put the values below in an untracked `.env` file at the repository root:

```dotenv
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-secret
ZROK_ENABLE_TOKEN=your-zrok-enable-token
```

Start the API in one terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn sellable.main:app --reload
```

Start a public zrok webhook tunnel in a second terminal:

```powershell
.\scripts\start-webhook-tunnel.ps1
```

The script uses the project-local `tools/zrok/zrok2.exe`. Get an enable token from your zrok account, expose it as `ZROK_ENABLE_TOKEN` in the shell, and run the script. Copy the public HTTPS URL it prints and append `/webhooks/razorpay`. In the Razorpay test dashboard, configure that as the webhook URL, use the same `RAZORPAY_WEBHOOK_SECRET`, and subscribe to `payment.captured` and `payment.failed`.

Never commit `.env`, expose the key secret in client code, or mark an order as paid from a browser callback. The signed webhook remains the authoritative settlement signal.
