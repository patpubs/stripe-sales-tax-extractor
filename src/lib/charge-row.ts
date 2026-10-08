import type Stripe from "stripe";
import { resolveChargeState } from "./address.ts";
import { ALL_STATES } from "./states.ts";

export type RowInsert = {
  report_id: string;
  charge_id: string;
  created: string;
  state: string | null;
  state_source: string | null;
  amount: number;
  amount_refunded: number;
  currency: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  description: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  payment_intent: string | null;
  invoice: string | null;
};

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

export function chargeToRow(reportId: string, charge: Stripe.Charge, wantState: string): RowInsert | null {
  // Only completed sales: succeeded and captured (not just authorized).
  if (charge.status !== "succeeded" || !charge.captured) return null;
  const addr = resolveChargeState(charge);
  if (wantState !== ALL_STATES && addr.state !== wantState) return null;

  const customer =
    charge.customer && typeof charge.customer === "object" && !("deleted" in charge.customer && charge.customer.deleted)
      ? (charge.customer as Stripe.Customer)
      : null;

  return {
    report_id: reportId,
    charge_id: charge.id,
    created: new Date(charge.created * 1000).toISOString(),
    state: addr.state,
    state_source: addr.source,
    amount: charge.amount,
    amount_refunded: charge.amount_refunded,
    currency: charge.currency,
    customer_id: idOf(charge.customer as string | { id: string } | null),
    customer_name: charge.billing_details?.name ?? charge.shipping?.name ?? customer?.name ?? null,
    customer_email: charge.billing_details?.email ?? charge.receipt_email ?? customer?.email ?? null,
    description: charge.description,
    city: addr.city,
    postal_code: addr.postal_code,
    country: addr.country,
    payment_intent: idOf(charge.payment_intent as string | { id: string } | null),
    // `invoice` was removed from Charge in newer API versions; read it defensively.
    invoice: idOf((charge as unknown as { invoice?: string | { id: string } | null }).invoice),
  };
}
