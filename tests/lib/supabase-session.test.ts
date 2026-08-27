import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { getCurrentSession } from "@/lib/supabase/session";

type ClientSetup = {
  claims?: { sub?: string } | null;
  claimsError?: Error | null;
  databaseError?: Error | null;
  member?: Record<string, unknown> | null;
};

function clientSetup({
  claims = { sub: "synthetic-auth-user" },
  claimsError = null,
  databaseError = null,
  member = {
    auth_user_id: "synthetic-auth-user",
    display_name: "デモ家族 あおい",
    household_id: "synthetic-household",
    id: "synthetic-member",
    role: "family",
  },
}: ClientSetup = {}) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: member, error: databaseError });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getClaims = vi
    .fn()
    .mockResolvedValue({ data: claims ? { claims } : null, error: claimsError });
  const getSession = vi.fn();

  const client = {
    auth: { getClaims, getSession },
    from,
  } as unknown as SupabaseClient;

  return { client, eq, from, getClaims, getSession, maybeSingle, select };
}

describe("HomeRelay Supabase session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when Supabase is unavailable", async () => {
    mocks.createClient.mockResolvedValue(null);

    await expect(getCurrentSession()).resolves.toBeNull();
  });

  it("verifies claims and resolves the current member by auth_user_id under RLS", async () => {
    const setup = clientSetup();

    await expect(getCurrentSession(setup.client)).resolves.toEqual({
      member: {
        authUserId: "synthetic-auth-user",
        displayName: "デモ家族 あおい",
        householdId: "synthetic-household",
        id: "synthetic-member",
        role: "family",
      },
      userId: "synthetic-auth-user",
    });
    expect(setup.getClaims).toHaveBeenCalledOnce();
    expect(setup.getSession).not.toHaveBeenCalled();
    expect(setup.from).toHaveBeenCalledWith("members");
    expect(setup.select).toHaveBeenCalledWith(
      "id, household_id, auth_user_id, display_name, role",
    );
    expect(setup.eq).toHaveBeenCalledWith(
      "auth_user_id",
      "synthetic-auth-user",
    );
    expect(setup.maybeSingle).toHaveBeenCalledOnce();
  });

  it("does not query members when verified claims are absent", async () => {
    const setup = clientSetup({ claims: null });

    await expect(getCurrentSession(setup.client)).resolves.toBeNull();
    expect(setup.from).not.toHaveBeenCalled();
    expect(setup.getSession).not.toHaveBeenCalled();
  });

  it.each([
    [{ role: "unknown" }],
    [{ auth_user_id: "another-user" }],
    [null],
  ])("rejects malformed or mismatched member rows", async (override) => {
    const baseMember = {
      auth_user_id: "synthetic-auth-user",
      display_name: "デモ家族 あおい",
      household_id: "synthetic-household",
      id: "synthetic-member",
      role: "family",
    };
    const member = override ? { ...baseMember, ...override } : null;
    const setup = clientSetup({ member });

    await expect(getCurrentSession(setup.client)).resolves.toBeNull();
  });

  it("fails closed without exposing database or auth errors", async () => {
    const databaseFailure = clientSetup({
      databaseError: new Error("synthetic database failure"),
    });
    await expect(getCurrentSession(databaseFailure.client)).resolves.toBeNull();

    const getClaims = vi.fn().mockRejectedValue(new Error("synthetic auth failure"));
    const client = { auth: { getClaims } } as unknown as SupabaseClient;
    await expect(getCurrentSession(client)).resolves.toBeNull();
  });
});
