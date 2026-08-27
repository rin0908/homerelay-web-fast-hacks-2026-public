"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentSession } from "@/lib/supabase/session";

type LoginOutcome = "invalid" | "membership" | "success" | "unavailable";

function loginInput(formData: FormData): { email: string; password: string } | null {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  if (typeof emailValue !== "string" || typeof passwordValue !== "string") {
    return null;
  }

  const email = emailValue.trim();
  if (
    !email ||
    email.length > 254 ||
    !email.includes("@") ||
    !passwordValue ||
    passwordValue.length > 512
  ) {
    return null;
  }

  return { email, password: passwordValue };
}

function destinationFor(outcome: LoginOutcome): string {
  if (outcome === "success") return "/";
  return `/login?error=${outcome}`;
}

export async function login(formData: FormData): Promise<void> {
  const input = loginInput(formData);
  if (!input) redirect(destinationFor("invalid"));

  const supabase = await createClient();
  if (!supabase) redirect(destinationFor("unavailable"));

  let outcome: LoginOutcome = "unavailable";

  try {
    const { error } = await supabase.auth.signInWithPassword(input);

    if (error) {
      outcome = "invalid";
    } else if (await getCurrentSession(supabase)) {
      outcome = "success";
    } else {
      outcome = "membership";
      await supabase.auth.signOut({ scope: "local" });
    }
  } catch {
    outcome = "unavailable";
  }

  redirect(destinationFor(outcome));
}
