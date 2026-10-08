"use client";
import { useActionState, useState, useTransition } from "react";
import { createLoginLink, inviteUser, removeUser, type ActionResult } from "@/app/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function InviteForm() {
  const [state, action] = useActionState(inviteUser, null);
  return (
    <form action={action} className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <div>
        <label className="label" htmlFor="invite_name">Name</label>
        <input id="invite_name" name="full_name" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="invite_email">Email</label>
        <input id="invite_email" name="email" type="email" required className="input" />
      </div>
      <SubmitButton className="btn-primary">Create invite</SubmitButton>
      <div className="md:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function UserActions({ userId, pendingInvite }: { userId: string; pendingInvite: boolean }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="w-full md:w-auto">
      <div className="flex justify-end gap-2">
        <button
          className="btn-secondary py-1.5"
          disabled={pending}
          onClick={() => start(async () => setResult(await createLoginLink(userId)))}
        >
          {pendingInvite ? "New invite link" : "New login link"}
        </button>
        <button
          className="btn-ghost text-red-600"
          disabled={pending}
          onClick={() => {
            if (confirm("Remove this user? They lose access immediately.")) {
              start(async () => setResult(await removeUser(userId)));
            }
          }}
        >
          Remove
        </button>
      </div>
      {result && (
        <div className="mt-2 md:max-w-xl">
          <FormMessage state={result} />
        </div>
      )}
    </div>
  );
}
