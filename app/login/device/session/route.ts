import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readBoundedRequest } from "@/lib/http/bounded-request";
import { createSupabaseAbortingFetch } from "@/lib/supabase/aborting-fetch";
import {
  classifyClaimsResult,
  isClearlyUnauthenticatedAuthError,
} from "@/lib/supabase/auth-resolution";
import { getSupabasePublicConfig } from "@/lib/supabase/env";
import { resolveCurrentSession } from "@/lib/supabase/session";
import {
  activeSessionGuardValue,
  isHomeRelayAuthCookieName,
  readSessionGuard,
  SESSION_GUARD_COOKIE_NAME,
  SESSION_GUARD_COOKIE_OPTIONS,
  sessionGuardAllows,
  signedOutSessionGuardValue,
} from "@/lib/supabase/session-guard";

function noStore(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function json(status: number, ok: boolean): NextResponse {
  return noStore(NextResponse.json({ ok }, { status }));
}

type BufferedCookie = {
  name: string;
  options: CookieOptions;
  value: string;
};

function applyBufferedCookies(
  response: NextResponse,
  pendingCookies: readonly BufferedCookie[],
  pendingHeaders: ReadonlyMap<string, string>,
): NextResponse {
  pendingCookies.forEach(({ name, options, value }) => {
    response.cookies.set(name, value, options);
  });
  pendingHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}

function clearHomeRelayAuthCookies(
  request: NextRequest,
  response: NextResponse,
  supabaseUrl: string,
  additionalNames: readonly string[] = [],
): void {
  const names = new Set([
    ...request.cookies.getAll().map(({ name }) => name),
    ...additionalNames,
  ]);
  names.forEach((name) => {
    if (!isHomeRelayAuthCookieName(name, supabaseUrl)) return;
    response.cookies.set(name, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  });
}

function markSignedOut(response: NextResponse): void {
  response.cookies.set(
    SESSION_GUARD_COOKIE_NAME,
    signedOutSessionGuardValue(),
    SESSION_GUARD_COOKIE_OPTIONS,
  );
}

function rejectSession(
  request: NextRequest,
  supabaseUrl: string,
  status = 401,
  additionalCookieNames: readonly string[] = [],
): NextResponse {
  const response = json(status, false);
  markSignedOut(response);
  clearHomeRelayAuthCookies(
    request,
    response,
    supabaseUrl,
    additionalCookieNames,
  );
  return response;
}

type CompletionExpectation =
  | {
      status: "ok";
      value: {
        authUserId: string;
        expectedRole: "family" | "helper";
      };
    }
  | { status: "malformed" | "too_large" };

async function completionExpectation(
  request: NextRequest,
): Promise<CompletionExpectation> {
  const bounded = await readBoundedRequest(request, 512);
  if (bounded.status !== "ok") return { status: bounded.status };
  try {
    const body = (await bounded.request.json()) as {
      authUserId?: unknown;
      expectedRole?: unknown;
    };
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.authUserId !== "string" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(body.authUserId) ||
      (body.expectedRole !== "family" && body.expectedRole !== "helper")
    ) {
      return { status: "malformed" };
    }
    return {
      status: "ok",
      value: {
        authUserId: body.authUserId,
        expectedRole: body.expectedRole,
      },
    };
  } catch {
    return { status: "malformed" };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return json(403, false);
  }

  const config = getSupabasePublicConfig();
  if (!config) return json(503, false);

  let pendingCookies: BufferedCookie[] = [];
  const pendingHeaders = new Map<string, string>();
  const supabase = createServerClient(config.url, config.publishableKey, {
    global: { fetch: createSupabaseAbortingFetch() },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        pendingCookies = cookiesToSet;
        Object.entries(headers).forEach(([name, value]) => {
          pendingHeaders.set(name, value);
        });
      },
    },
  });

  const guard = readSessionGuard(
    request.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value,
  );
  const phase = requestUrl.searchParams.get("phase");

  if (phase === "begin") {
    if (guard.state !== "signed-out") {
      try {
        const current = await supabase.auth.getClaims();
        if (current.error && !isClearlyUnauthenticatedAuthError(current.error)) {
          return json(503, false);
        }
        if (!current.error) {
          const currentResolution = classifyClaimsResult(current);
          if (currentResolution.state === "indeterminate") {
            return json(503, false);
          }
          if (currentResolution.state === "verified") {
            const guardMatches = await sessionGuardAllows(
              guard,
              currentResolution.value.sessionId,
            );
            if (guardMatches) {
              return applyBufferedCookies(
                json(409, false),
                pendingCookies,
                pendingHeaders,
              );
            }
          }
        }
      } catch {
        // An unverifiable current session may still be active. Do not mutate
        // its guard or cookies until Auth can establish the current state.
        return json(503, false);
      }
    }

    const response = json(200, true);
    markSignedOut(response);
    clearHomeRelayAuthCookies(request, response, config.url);
    return response;
  }

  if (phase !== "complete" || guard.state !== "signed-out") {
    return rejectSession(request, config.url);
  }

  try {
    const expected = await completionExpectation(request);
    if (expected.status !== "ok") {
      return rejectSession(
        request,
        config.url,
        expected.status === "too_large" ? 413 : 400,
      );
    }

    const resolution = await resolveCurrentSession(supabase);
    if (resolution.state === "indeterminate") return json(503, false);
    if (resolution.state === "unauthenticated") {
      return rejectSession(
        request,
        config.url,
        401,
        pendingCookies.map(({ name }) => name),
      );
    }
    if (resolution.state === "forbidden") {
      return rejectSession(
        request,
        config.url,
        403,
        pendingCookies.map(({ name }) => name),
      );
    }

    const { session } = resolution;
    if (session.member.role !== expected.value.expectedRole) {
      return rejectSession(
        request,
        config.url,
        403,
        pendingCookies.map(({ name }) => name),
      );
    }
    if (session.userId !== expected.value.authUserId) {
      return rejectSession(
        request,
        config.url,
        401,
        pendingCookies.map(({ name }) => name),
      );
    }

    const guardValue = await activeSessionGuardValue(session.sessionId);
    if (!guardValue) return json(503, false);

    const response = json(200, true);
    response.cookies.set(
      SESSION_GUARD_COOKIE_NAME,
      guardValue,
      SESSION_GUARD_COOKIE_OPTIONS,
    );
    return applyBufferedCookies(response, pendingCookies, pendingHeaders);
  } catch {
    return json(503, false);
  }
}
