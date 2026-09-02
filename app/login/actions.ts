"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/env";
import { getCurrentSession } from "@/lib/supabase/session";
import {
  activeSessionGuardValue,
  isHomeRelayAuthCookieName,
  readSessionGuard,
  SESSION_GUARD_COOKIE_NAME,
  SESSION_GUARD_COOKIE_OPTIONS,
  sessionGuardAllows,
  sessionIdFromClaims,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

type LoginOutcome = "invalid" | "membership" | "success" | "unavailable";
type CookieStore = Awaited<ReturnType<typeof cookies>>;
type ExistingMembership = "member" | "missing" | "unavailable";

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

function clearHomeRelayAuthCookies(
  cookieStore: CookieStore,
  supabaseUrl: string,
): void {
  cookieStore.getAll().forEach(({ name }) => {
    if (!isHomeRelayAuthCookieName(name, supabaseUrl)) return;
    cookieStore.set(name, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  });
}

function markSignedOut(cookieStore: CookieStore): void {
  cookieStore.set(
    SESSION_GUARD_COOKIE_NAME,
    signedOutSessionGuardValue(),
    SESSION_GUARD_COOKIE_OPTIONS,
  );
}

async function existingMembership(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<ExistingMembership> {
  try {
    const { data, error } = await supabase
      .from("members")
      .select("auth_user_id, role")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (error) return "unavailable";
    if (!data) return "missing";
    const row = data as { auth_user_id?: unknown; role?: unknown };
    return row.auth_user_id === authUserId &&
      (row.role === "family" ||
        row.role === "relative" ||
        row.role === "helper")
      ? "member"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function signOutAndConfirm(supabase: SupabaseClient): Promise<boolean> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The read-back below is authoritative.
  }

  try {
    const current = await supabase.auth.getSession();
    return !current.error && current.data.session === null;
  } catch {
    return false;
  }
}

export async function login(formData: FormData): Promise<void> {
  const input = loginInput(formData);
  if (!input) redirect(destinationFor("invalid"));

  const config = getSupabasePublicConfig();
  const cookieStore = await cookies();
  const guard = readSessionGuard(
    cookieStore.get(SESSION_GUARD_COOKIE_NAME)?.value,
  );

  // A signed-out/malformed guard always wins over a late Supabase cookie.
  // Remove only this HomeRelay project's auth cookies before constructing the
  // login client; unrelated applications and Supabase projects are untouched.
  if (config && guard.state === "signed-out") {
    clearHomeRelayAuthCookies(cookieStore, config.url);
  }

  const supabase = await createClient();
  if (!supabase || !config) redirect(destinationFor("unavailable"));

  if (guard.state !== "signed-out") {
    let existingSessionCleared = false;
    let existing: Awaited<ReturnType<typeof supabase.auth.getClaims>> | null =
      null;
    try {
      existing = await supabase.auth.getClaims();
    } catch {
      if (guard.state === "absent") {
        redirect(destinationFor("unavailable"));
      }
    }

    const existingClaims = existing?.data?.claims;
    const existingUserId = existingClaims?.sub;
    const existingGuardMatches = await sessionGuardAllows(
      guard,
      sessionIdFromClaims(existingClaims),
    );
    if (
      !existing?.error &&
      typeof existingUserId === "string" &&
      existingGuardMatches
    ) {
      const membership = await existingMembership(supabase, existingUserId);
      if (membership === "member") redirect("/");
      if (membership === "unavailable") {
        redirect(destinationFor("unavailable"));
      }
      if (!(await signOutAndConfirm(supabase))) {
        redirect(destinationFor("unavailable"));
      }
      markSignedOut(cookieStore);
      clearHomeRelayAuthCookies(cookieStore, config.url);
      existingSessionCleared = true;
    }

    if (guard.state === "absent" && (!existing || existing.error)) {
      redirect(destinationFor("unavailable"));
    }

    if (guard.state === "active" && !existingSessionCleared) {
      if (!(await signOutAndConfirm(supabase))) {
        redirect(destinationFor("unavailable"));
      }
      markSignedOut(cookieStore);
      clearHomeRelayAuthCookies(cookieStore, config.url);
    }
  }

  let outcome: LoginOutcome = "unavailable";

  try {
    const signIn = await supabase.auth.signInWithPassword(input);

    if (signIn.error) {
      outcome = "invalid";
    } else {
      const signedInUserId = signIn.data.user?.id;
      const session = await getCurrentSession(supabase);
      const claims = await supabase.auth.getClaims();
      const authUserId = claims.data?.claims?.sub;
      const sessionId = sessionIdFromClaims(claims.data?.claims);
      const guardValue =
        session &&
        typeof signedInUserId === "string" &&
        session.userId === signedInUserId &&
        session.sessionId === sessionId &&
        authUserId === signedInUserId &&
        !claims.error && sessionId
          ? await activeSessionGuardValue(sessionId)
          : null;
      if (guardValue) {
        cookieStore.set(
          SESSION_GUARD_COOKIE_NAME,
          guardValue,
          SESSION_GUARD_COOKIE_OPTIONS,
        );
        outcome = "success";
      } else if (!session) {
        outcome = "membership";
      }
    }
  } catch {
    outcome = "unavailable";
  }

  if (outcome !== "success") {
    await signOutAndConfirm(supabase);
    markSignedOut(cookieStore);
    clearHomeRelayAuthCookies(cookieStore, config.url);
  }

  redirect(destinationFor(outcome));
}
