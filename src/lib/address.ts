import type Stripe from "stripe";
import { normalizeState } from "./states.ts";

export type ResolvedAddress = {
  state: string | null;
  source: "shipping" | "billing" | "customer_shipping" | "customer" | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
};

type Addr = Stripe.Address | null | undefined;

function usState(addr: Addr): string | null {
  if (!addr) return null;
  // Only US addresses count. A blank country is accepted because many
  // checkouts only collect the state and ZIP.
  if (addr.country && addr.country.toUpperCase() !== "US") return null;
  return normalizeState(addr.state);
}

/**
 * Pick the state a sale belongs to. Ship-to wins (that's where sales tax is
 * sourced for shipped goods), then billing, then the customer's saved addresses.
 */
export function resolveChargeState(charge: Stripe.Charge): ResolvedAddress {
  const customer =
    charge.customer && typeof charge.customer === "object" && !("deleted" in charge.customer && charge.customer.deleted)
      ? (charge.customer as Stripe.Customer)
      : null;

  const candidates: Array<[ResolvedAddress["source"], Addr]> = [
    ["shipping", charge.shipping?.address],
    ["billing", charge.billing_details?.address],
    ["customer_shipping", customer?.shipping?.address],
    ["customer", customer?.address],
  ];

  for (const [source, addr] of candidates) {
    const state = usState(addr);
    if (state) {
      return {
        state,
        source,
        city: addr?.city ?? null,
        postal_code: addr?.postal_code ?? null,
        country: addr?.country ?? null,
      };
    }
  }

  const fallback = charge.shipping?.address ?? charge.billing_details?.address ?? customer?.address;
  return {
    state: null,
    source: null,
    city: fallback?.city ?? null,
    postal_code: fallback?.postal_code ?? null,
    country: fallback?.country ?? null,
  };
}
