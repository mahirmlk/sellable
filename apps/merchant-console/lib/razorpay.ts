"use client";

interface CheckoutOptions {
  key: string;
  amountPaise: number;
  orderId: string;
  name: string;
  description: string;
  onSuccess: (paymentId: string) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}

let scriptPromise: Promise<boolean> | null = null;

function loadCheckoutScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const existing = document.getElementById("razorpay-checkout-js");
    if (existing) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.id = "razorpay-checkout-js";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Opens the real Razorpay Test-Mode checkout for an order created by the
 * backend. Returns true when the checkout modal was opened. The browser only
 * receives the public key id — never the secret.
 */
export async function openRazorpayCheckout(options: CheckoutOptions): Promise<boolean> {
  if (typeof window === "undefined" || !options.key) return false;
  const loaded = await loadCheckoutScript();
  if (!loaded || !window.Razorpay) return false;
  const razorpay = new window.Razorpay({
    key: options.key,
    amount: options.amountPaise,
    currency: "INR",
    name: options.name,
    description: options.description,
    order_id: options.orderId,
    theme: { color: "#f97316" },
    handler: (response: { razorpay_payment_id?: string }) => {
      if (response.razorpay_payment_id) {
        options.onSuccess(response.razorpay_payment_id);
      }
    },
    modal: { ondismiss: () => undefined },
  });
  razorpay.open();
  return true;
}