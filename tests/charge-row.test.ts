import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { chargeToRow } from "../src/lib/charge-row.ts";

function charge(over: Partial<Stripe.Charge> & Record<string, unknown> = {}): Stripe.Charge {
  return {
    id: "ch_1",
    object: "charge",
    amount: 5000,
    amount_refunded: 0,
    captured: true,
    status: "succeeded",
    created: 1788000000,
    currency: "usd",
    customer: null,
    description: "Order 1",
    billing_details: { address: null, email: "b@x.com", name: "Buyer", phone: null },
    shipping: null,
    payment_intent: "pi_1",
    receipt_email: null,
    livemode: true,
    ...over,
  } as unknown as Stripe.Charge;
}

const addr = (state: string | null, country: string | null = "US") =>
  ({ city: "Tulsa", country, line1: null, line2: null, postal_code: "74103", state }) as Stripe.Address;

test("matches on shipping state first", () => {
  const row = chargeToRow("r", charge({ shipping: { address: addr("Oklahoma"), name: "S" } as Stripe.Charge.Shipping, billing_details: { address: addr("TX"), email: null, name: null, phone: null } as Stripe.Charge.BillingDetails }), "OK");
  assert.equal(row?.state, "OK");
  assert.equal(row?.state_source, "shipping");
  assert.equal(chargeToRow("r", charge({ shipping: { address: addr("OK") } as Stripe.Charge.Shipping }), "TX"), null);
});

test("falls back to billing, then expanded customer address", () => {
  const billing = chargeToRow("r", charge({ billing_details: { address: addr("ok"), email: null, name: null, phone: null } as Stripe.Charge.BillingDetails }), "OK");
  assert.equal(billing?.state_source, "billing");
  const cust = chargeToRow("r", charge({ customer: { id: "cus_1", object: "customer", address: addr("OK"), email: "c@x.com", name: "Cust", shipping: null } as unknown as Stripe.Customer }), "OK");
  assert.equal(cust?.state_source, "customer");
  assert.equal(cust?.customer_id, "cus_1");
});

test("skips non-US addresses, failed and uncaptured charges", () => {
  assert.equal(chargeToRow("r", charge({ billing_details: { address: addr("ON", "CA") } as Stripe.Charge.BillingDetails }), "OK"), null);
  assert.equal(chargeToRow("r", charge({ status: "failed", billing_details: { address: addr("OK") } as Stripe.Charge.BillingDetails }), "OK"), null);
  assert.equal(chargeToRow("r", charge({ captured: false, billing_details: { address: addr("OK") } as Stripe.Charge.BillingDetails }), "OK"), null);
});

test("ALL keeps every completed sale, including unknown state", () => {
  const row = chargeToRow("r", charge({ amount_refunded: 1000 }), "ALL");
  assert.equal(row?.state, null);
  assert.equal(row?.amount_refunded, 1000);
  assert.equal(row?.created, new Date(1788000000 * 1000).toISOString());
});
