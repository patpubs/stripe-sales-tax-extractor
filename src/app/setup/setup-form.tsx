"use client";
import { useActionState } from "react";
import { createSuperAdmin } from "@/app/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";

export function SetupForm() {
  const [state, action] = useActionState(createSuperAdmin, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="full_name">Your name</label>
        <input id="full_name" name="full_name" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton>Create admin account</SubmitButton>
    </form>
  );
}
