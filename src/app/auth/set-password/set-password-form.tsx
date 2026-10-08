"use client";
import { useActionState } from "react";
import { setPassword } from "@/app/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function SetPasswordForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(setPassword, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="full_name">Your name</label>
        <input id="full_name" name="full_name" defaultValue={defaultName} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton>Save and continue</SubmitButton>
    </form>
  );
}
