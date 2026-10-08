export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralize spreadsheet formula injection from customer-entered text.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}

export function cents(n: number | null | undefined): string {
  return ((n ?? 0) / 100).toFixed(2);
}
