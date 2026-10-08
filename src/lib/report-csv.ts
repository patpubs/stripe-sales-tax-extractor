import "server-only";
import { createAdminClient } from "./supabase/admin";
import { csvLine, cents } from "./csv";
import type { CsvVariant } from "./report-variants";
import { stateName } from "./states";

const BATCH = 1000;

type Row = {
  report_id: string;
  charge_id: string;
  created: string;
  state: string | null;
  state_source: string | null;
  amount: number;
  amount_refunded: number;
  currency: string;
  customer_name: string | null;
  customer_email: string | null;
  description: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  payment_intent: string | null;
};

export type CsvSource = { id: string; account_name: string; timezone: string };

/**
 * Stream a CSV for one report or several (a combined report). With several
 * reports, rows from all accounts are merged by date and an Account column is
 * added. Every download is logged in `downloads`.
 */
export async function reportCsvResponse(opts: {
  sources: CsvSource[];
  state: string;
  periodLabel: string;
  variant: CsvVariant;
  userId: string;
  log: { report_id?: string; group_id?: string };
}): Promise<Response> {
  const { sources, variant } = opts;
  const db = createAdminClient();
  const combined = sources.length > 1;
  const ids = sources.map((s) => s.id);
  const accountOf = new Map(sources.map((s) => [s.id, s.account_name]));
  const accountNames = sources.map((s) => s.account_name);

  const filename =
    [combined ? "combined" : slug(accountNames[0] ?? "stripe"), opts.state.toLowerCase(), slug(opts.periodLabel), variant]
      .filter(Boolean)
      .join("_") + ".csv";

  const { data: download } = await db
    .from("downloads")
    .insert({ ...opts.log, user_id: opts.userId, variant, filename })
    .select("id")
    .single();

  const encoder = new TextEncoder();
  let rowCount = 0;
  const timezones = [...new Set(sources.map((s) => s.timezone))].join(", ");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        // Header block describing the report.
        write(csvLine([combined ? "Stripe accounts" : "Stripe account", accountNames.join(" + ")]));
        write(csvLine(["State", stateName(opts.state)]));
        write(csvLine(["Period", opts.periodLabel, `(${timezones})`]));
        write(csvLine(["Report", variantLabel(variant)]));
        write(csvLine(["Generated", new Date().toISOString()]));
        write("\r\n");

        if (variant === "summary") {
          const { data: summary, error } = await db.rpc("reports_state_summary", { p_report_ids: ids });
          if (error) throw error;
          write(csvLine(["State", "Transactions", "Gross Sales", "Refunds", "Net Sales", "Refunded Transactions"]));
          let t = { n: 0, g: 0, r: 0, rc: 0 };
          for (const s of summary ?? []) {
            write(csvLine([s.state === "??" ? "Unknown" : s.state, s.transaction_count, cents(s.gross), cents(s.refunded), cents(s.net), s.refunded_count]));
            t = { n: t.n + Number(s.transaction_count), g: t.g + Number(s.gross), r: t.r + Number(s.refunded), rc: t.rc + Number(s.refunded_count) };
            rowCount++;
          }
          write(csvLine(["TOTAL", t.n, cents(t.g), cents(t.r), cents(t.g - t.r), t.rc]));
        } else {
          const lead = (cols: unknown[], account: string) => (combined ? [account, ...cols] : cols);
          write(csvLine(lead(header(variant), "Account")));
          let total = { gross: 0, refunded: 0, net: 0 };
          for (let offset = 0; ; offset += BATCH) {
            let q = db
              .from("report_rows")
              .select("*")
              .in("report_id", ids)
              .order("created", { ascending: true })
              .order("charge_id", { ascending: true })
              .range(offset, offset + BATCH - 1);
            if (variant === "no_refunds") q = q.eq("amount_refunded", 0);
            const { data, error } = await q;
            if (error) throw error;
            for (const r of (data ?? []) as Row[]) {
              const net = r.amount - r.amount_refunded;
              if (variant === "net" && net <= 0) continue;
              write(csvLine(lead(line(variant, r), accountOf.get(r.report_id) ?? "")));
              total = { gross: total.gross + r.amount, refunded: total.refunded + r.amount_refunded, net: total.net + net };
              rowCount++;
            }
            if (!data || data.length < BATCH) break;
          }
          const totals = totalLine(variant, total, rowCount);
          write(csvLine(combined ? [totals[0], "", ...totals.slice(1)] : totals));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        if (download) await db.from("downloads").update({ row_count: rowCount }).eq("id", download.id);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

const BASE = ["Date (UTC)", "Charge ID", "Customer", "Email", "City", "State", "ZIP", "Country", "Description"];

function header(v: CsvVariant): string[] {
  switch (v) {
    case "gross":
    case "no_refunds":
      return [...BASE, "Amount", "Currency", "Address Source"];
    case "net":
      return [...BASE, "Gross", "Refunded", "Net Amount", "Currency", "Address Source"];
    default:
      return [...BASE, "Gross", "Refunded", "Net", "Currency", "Address Source", "Payment Intent"];
  }
}

function line(v: CsvVariant, r: Row): unknown[] {
  const base = [
    r.created.replace("T", " ").slice(0, 19),
    r.charge_id,
    r.customer_name,
    r.customer_email,
    r.city,
    r.state,
    r.postal_code,
    r.country,
    r.description,
  ];
  const net = r.amount - r.amount_refunded;
  switch (v) {
    case "gross":
    case "no_refunds":
      return [...base, cents(r.amount), r.currency.toUpperCase(), r.state_source];
    case "net":
      return [...base, cents(r.amount), cents(r.amount_refunded), cents(net), r.currency.toUpperCase(), r.state_source];
    default:
      return [...base, cents(r.amount), cents(r.amount_refunded), cents(net), r.currency.toUpperCase(), r.state_source, r.payment_intent];
  }
}

function totalLine(v: CsvVariant, t: { gross: number; refunded: number; net: number }, n: number): unknown[] {
  const pad = Array(BASE.length - 2).fill("");
  const label = [`TOTAL (${n} transactions)`, ""];
  switch (v) {
    case "gross":
    case "no_refunds":
      return [...label, ...pad, cents(t.gross)];
    default:
      return [...label, ...pad, cents(t.gross), cents(t.refunded), cents(t.net)];
  }
}

function variantLabel(v: CsvVariant): string {
  return {
    full: "Itemized: gross, refunds and net",
    gross: "Total sales (gross, refunds ignored)",
    net: "Net sales (gross minus refunds; fully refunded sales omitted)",
    no_refunds: "Sales with no refunds only",
    summary: "Summary by state",
  }[v];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
