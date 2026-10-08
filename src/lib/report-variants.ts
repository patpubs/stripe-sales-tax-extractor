export const CSV_VARIANTS = {
  full: { label: "Itemized (gross, refunds, net)", short: "Itemized" },
  gross: { label: "Total sales (gross)", short: "Gross" },
  net: { label: "Net sales (minus refunds)", short: "Net" },
  no_refunds: { label: "Only sales with no refunds", short: "No refunds" },
  summary: { label: "Summary by state", short: "Summary" },
} as const;

export type CsvVariant = keyof typeof CSV_VARIANTS;

export function isCsvVariant(v: string | null): v is CsvVariant {
  return !!v && v in CSV_VARIANTS;
}
