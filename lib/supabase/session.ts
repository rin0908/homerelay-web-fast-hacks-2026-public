import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyClaimsResult } from "@/lib/supabase/auth-resolution";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/types/handoff";

export type CurrentMember = {
  authUserId: string;
  displayName: string;
  householdId: string;
  id: string;
  role: MemberRole;
};

export type HomeRelaySession = {
  member: CurrentMember;
  sessionId: string;
  userId: string;
};

export type HomeRelaySessionResolution =
  | { state: "forbidden" }
  | { state: "indeterminate" }
  | { state: "unauthenticated" }
  | { session: HomeRelaySession; state: "verified" };

type MemberRow = {
  auth_user_id: unknown;
  display_name: unknown;
  household_id: unknown;
  id: unknown;
  role: unknown;
};

function isMemberRole(value: unknown): value is MemberRole {
  return value === "family" || value === "relative" || value === "helper";
}

function parseMember(row: MemberRow | null, authUserId: string): CurrentMember | null {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.household_id !== "string" ||
    typeof row.auth_user_id !== "string" ||
    typeof row.display_name !== "string" ||
    row.auth_user_id !== authUserId ||
    !isMemberRole(row.role)
  ) {
    return null;
  }

  return {
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    householdId: row.household_id,
    id: row.id,
    role: row.role,
  };
}

export async function resolveCurrentSession(
  existingClient?: SupabaseClient,
): Promise<HomeRelaySessionResolution> {
  try {
    const supabase = existingClient ?? (await createClient());
    if (!supabase) return { state: "indeterminate" };

    const claims = classifyClaimsResult(await supabase.auth.getClaims());
    if (claims.state !== "verified") return { state: claims.state };
    const { sessionId, userId: authUserId } = claims.value;

    const { data, error } = await supabase
      .from("members")
      .select("id, household_id, auth_user_id, display_name, role")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error) return { state: "indeterminate" };

    if (data === null) return { state: "forbidden" };

    const member = parseMember(data as MemberRow | null, authUserId);
    return member
      ? {
          session: { member, sessionId, userId: authUserId },
          state: "verified",
        }
      : { state: "indeterminate" };
  } catch {
    return { state: "indeterminate" };
  }
}

export async function getCurrentSession(
  existingClient?: SupabaseClient,
): Promise<HomeRelaySession | null> {
  const resolution = await resolveCurrentSession(existingClient);
  return resolution.state === "verified" ? resolution.session : null;
}
