"use client";
import type { ActionResult } from "@/app/actions";
import { CopyButton } from "./copy-button";

export function FormMessage({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (!state.ok) {
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  }
  if (!state.message) return null;
  return (
    <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
      <p>{state.message}</p>
      {state.link && (
        <div className="mt-2 flex items-center gap-2">
          <input readOnly value={state.link} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={state.link} />
        </div>
      )}
    </div>
  );
}
