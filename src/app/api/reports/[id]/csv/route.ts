import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { csvLine, cents } from "@/lib/csv";
import { isCsvVariant, type CsvVariant } from "@/lib/report-variants";
import { stateName } from "@/lib/states";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 1000;

type Row = {
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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const variantParam = req.nextUrl.searchParams.get("variant");
  const variant: CsvVariant = isCsvVariant(variantParam) ? variantParam : "full";

  const db = createAdminClient();
  const { data: report } = await db
    .from("reports")
    .select("*, stripe_accounts(name)")
    .eq("id", id)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (report.status !== "ready") return NextResponse.json({ error: "report is not ready" }, { status: 409 });

  const accountName: string = report.stripe_accounts?.name ?? "stripe";
  const filename = [slug(accountName), report.state.toLowerCase(), slug(report.period_label), variant]
    .filter(Boolean)
    .join("_") + ".csv";

  const { data: download } = await db
    .from("downloads")
    .insert({ report_id: report.id, user_id: user.id, variant, filename })
    .select("id")
    .single();

  const encoder = new TextEncoder();
  let rowCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        // Header block describing the report.
        write(csvLine(["Stripe account", accountName]));
        write(csvLine(["State", stateName(report.state)]));
        write(csvLine(["Period", report.period_label, `(${report.timezone})`]));
        write(csvLine(["Report", variantLabel(variant)]));
        write(csvLine(["Generated", new Date().toISOString()]));
        write("\r\n");

        if (variant === "summary") {
          const { data: summary, error } = await db.rpc("report_state_summary", { p_report_id: report.id });
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
          write(csvLine(header(variant)));
          let total = { gross: 0, refunded: 0, net: 0 };
          for (let offset = 0; ; offset += BATCH) {
            let q = db
              .from("report_rows")
              .select("*")
              .eq("report_id", report.id)
              .order("created", { ascending: true })
              .order("charge_id", { ascending: true })
              .range(offset, offset + BATCH - 1);
            if (variant === "no_refunds") q = q.eq("amount_refunded", 0);
            const { data, error } = await q;
            if (error) throw error;
            for (const r of (data ?? []) as Row[]) {
              const net = r.amount - r.amount_refunded;
              if (variant === "net" && net <= 0) continue;
              write(csvLine(line(variant, r)));
              total = { gross: total.gross + r.amount, refunded: total.refunded + r.amount_refunded, net: total.net + net };
              rowCount++;
            }
            if (!data || data.length < BATCH) break;
          }
          write(csvLine(totalLine(variant, total, rowCount)));
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
