import { NextResponse, type NextRequest } from "next/server";

import { readBoundedRequest } from "@/lib/http/bounded-request";
import { getSupabasePublicConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
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

function clearHomeRelayAuthCookies(
  request: NextRequest,
  response: NextResponse,
  supabaseUrl: string,
): void {
  request.cookies.getAll().forEach(({ name }) => {
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
): NextResponse {
  const response = json(status, false);
  markSignedOut(response);
  clearHomeRelayAuthCookies(request, response, supabaseUrl);
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
  const supabase = await createClient();
  if (!config || !supabase) return json(503, false);

  const guard = readSessionGuard(
    request.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value,
  );
  const phase = requestUrl.searchParams.get("phase");

  if (phase === "begin") {
    if (guard.state !== "signed-out") {
      try {
        const current = await supabase.auth.getClaims();
        const currentUserId = current.data?.claims?.sub;
        const guardMatches = await sessionGuardAllows(
          guard,
          sessionIdFromClaims(current.data?.claims),
        );
        if (
          !current.error &&
          typeof currentUserId === "string" &&
          guardMatches
        ) {
          return json(409, false);
        }
      } catch {
        // Beginning an explicit one-time login may safely discard an
        // unverifiable local session; it never grants access.
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

    const session = await getCurrentSession(supabase);
    const claims = await supabase.auth.getClaims();
    const authUserId = claims.data?.claims?.sub;
    const sessionId = sessionIdFromClaims(claims.data?.claims);
    const guardValue =
      session &&
      !claims.error &&
      authUserId === expected.value.authUserId &&
      session.userId === expected.value.authUserId &&
      session.sessionId === sessionId &&
      session.member.role === expected.value.expectedRole &&
      sessionId
        ? await activeSessionGuardValue(sessionId)
        : null;

    if (!guardValue) return rejectSession(request, config.url);

    const response = json(200, true);
    response.cookies.set(
      SESSION_GUARD_COOKIE_NAME,
      guardValue,
      SESSION_GUARD_COOKIE_OPTIONS,
    );
    return response;
  } catch {
    return rejectSession(request, config.url);
  }
}
