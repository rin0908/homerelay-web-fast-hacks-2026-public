import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import {
  getCurrentSession,
  resolveCurrentSession,
} from "@/lib/supabase/session";

type ClientSetup = {
  claims?: { session_id?: string; sub?: string } | null;
  claimsError?: unknown;
  databaseError?: unknown;
  member?: Record<string, unknown> | null;
};

function clientSetup({
  claims = {
    session_id: "11111111-1111-4111-8111-111111111111",
    sub: "synthetic-auth-user",
  },
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
      sessionId: "11111111-1111-4111-8111-111111111111",
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

  it("exposes a verified resolution while preserving getCurrentSession compatibility", async () => {
    const setup = clientSetup();

    await expect(resolveCurrentSession(setup.client)).resolves.toMatchObject({
      session: { userId: "synthetic-auth-user" },
      state: "verified",
    });
  });

  it("distinguishes a clear missing session from an unavailable auth read", async () => {
    const missing = clientSetup({ claims: null });
    await expect(resolveCurrentSession(missing.client)).resolves.toEqual({
      state: "unauthenticated",
    });

    const expired = clientSetup({
      claims: null,
      claimsError: {
        code: "session_not_found",
        name: "AuthSessionMissingError",
        status: 400,
      },
    });
    await expect(resolveCurrentSession(expired.client)).resolves.toEqual({
      state: "unauthenticated",
    });

    for (const claimsError of [
      new Error("synthetic unknown SDK failure"),
      { status: 401 },
      { status: 403 },
      { code: "over_request_rate_limit", status: 429 },
      { code: "unexpected_failure", status: 503 },
    ]) {
      const unavailable = clientSetup({ claims: null, claimsError });
      await expect(resolveCurrentSession(unavailable.client)).resolves.toEqual({
        state: "indeterminate",
      });
    }
  });

  it("distinguishes confirmed membership absence from database uncertainty", async () => {
    const absent = clientSetup({ member: null });
    await expect(resolveCurrentSession(absent.client)).resolves.toEqual({
      state: "forbidden",
    });

    const unavailable = clientSetup({
      databaseError: new Error("synthetic database failure"),
      member: null,
    });
    await expect(resolveCurrentSession(unavailable.client)).resolves.toEqual({
      state: "indeterminate",
    });

    const malformed = clientSetup({ member: { id: "malformed" } });
    await expect(resolveCurrentSession(malformed.client)).resolves.toEqual({
      state: "indeterminate",
    });
  });

  it("does not query members when verified claims are absent", async () => {
    const setup = clientSetup({ claims: null });

    await expect(getCurrentSession(setup.client)).resolves.toBeNull();
    expect(setup.from).not.toHaveBeenCalled();
    expect(setup.getSession).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { sub: "synthetic-auth-user" }],
    ["too short", { session_id: "short", sub: "synthetic-auth-user" }],
    [
      "invalid characters",
      { session_id: "invalid session id", sub: "synthetic-auth-user" },
    ],
  ])("rejects a %s session_id claim before querying members", async (_name, claims) => {
    const setup = clientSetup({ claims });

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
