import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
  userId: string;
};

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

export async function getCurrentSession(
  existingClient?: SupabaseClient,
): Promise<HomeRelaySession | null> {
  try {
    const supabase = existingClient ?? (await createClient());
    if (!supabase) return null;

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    const authUserId = claimsData?.claims?.sub;

    if (claimsError || typeof authUserId !== "string" || !authUserId) {
      return null;
    }

    const { data, error } = await supabase
      .from("members")
      .select("id, household_id, auth_user_id, display_name, role")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error) return null;

    const member = parseMember(data as MemberRow | null, authUserId);
    return member ? { member, userId: authUserId } : null;
  } catch {
    return null;
  }
}
