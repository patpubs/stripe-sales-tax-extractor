"use client";
import { useActionState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { deleteAlias, deleteTown, importTables, uploadBaseCopos } from "../actions";

export function TablesUpload() {
  const [baseState, baseAction] = useActionState(uploadBaseCopos, null);
  const [tablesState, tablesAction] = useActionState(importTables, null);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="card">
        <h2 className="text-lg font-semibold">Base COPO template</h2>
        <p className="mt-1 text-sm text-slate-500">
          CSV-BaseCopos from the Tax Commission filing portal. Replaces the current list; codes not in it are never
          written to an import file.
        </p>
        <form action={baseAction} className="mt-4 space-y-3">
          <input type="file" name="file" accept=".csv,text/csv" className="block text-sm" required />
          <FormMessage state={baseState} />
          <SubmitButton className="btn-primary">Upload template</SubmitButton>
        </form>
      </section>
      <section className="card">
        <h2 className="text-lg font-semibold">Lookup tables (JSON)</h2>
        <p className="mt-1 text-sm text-slate-500">
          An object with any of <code>city_copo</code>, <code>zip_county_map</code>, <code>city_to_county_fallback</code>{" "}
          and <code>valid_copos</code>. Entries are added or updated; nothing is removed. County codes are fixed by the
          Tax Commission&apos;s numbering, so <code>county_copo</code> is only checked.
        </p>
        <form action={tablesAction} className="mt-4 space-y-3">
          <input type="file" name="file" accept=".json,application/json" className="block text-sm" required />
          <FormMessage state={tablesState} />
          <SubmitButton className="btn-primary">Import tables</SubmitButton>
        </form>
      </section>
    </div>
  );
}

export function DeleteEntry({ kind, value }: { kind: "alias" | "town"; value: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost"
      title="Remove"
      disabled={pending}
      onClick={() => {
        if (confirm(`Remove "${value}"? Sales with it will need review again.`)) {
          start(async () => { await (kind === "alias" ? deleteAlias(value) : deleteTown(value)); });
        }
      }}
    >
      <Trash2 className="size-4" />
    </button>
  );
}
