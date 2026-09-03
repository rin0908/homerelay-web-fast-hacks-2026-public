import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseAbortingFetch } from "@/lib/supabase/aborting-fetch";
import {
  classifyClaimsResult,
  type ClaimsResolution,
} from "@/lib/supabase/auth-resolution";
import { getSupabasePublicConfig } from "@/lib/supabase/env";
import {
  isHomeRelayAuthCookieName,
  readSessionGuard,
  SESSION_GUARD_COOKIE_NAME,
  sessionGuardAllows,
  sessionIdFromClaims,
} from "@/lib/supabase/session-guard";

const PUBLIC_PATHS = new Set([
  "/api/session",
  "/api/status",
  "/login",
  "/logout",
]);
const DEVICE_SESSION_PATH = "/login/device/session";

type BufferedCookie = {
  name: string;
  options: CookieOptions;
  value: string;
};

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/login/");
}

function indeterminateSessionResponse(request: NextRequest): NextResponse {
  // Public recovery and status routes must remain reachable when Auth cannot
  // determine session state. Use a fresh response based only on the original
  // request: buffered refresh cookies and headers have not been verified and
  // must never cross this boundary.
  return makePrivate(
    isPublicPath(request.nextUrl.pathname)
      ? NextResponse.next({ request })
      : new NextResponse(null, { status: 503 }),
  );
}

function makePrivate(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function applyHeaders(
  response: NextResponse,
  headers: ReadonlyMap<string, string>,
): void {
  headers.forEach((value, name) => response.headers.set(name, value));
}

function applyBufferedCookies(
  response: NextResponse,
  cookies: readonly BufferedCookie[],
): void {
  cookies.forEach(({ name, options, value }) => {
    response.cookies.set(name, value, options);
  });
}

function homeRelayAuthCookieNames(
  request: NextRequest,
  supabaseUrl: string,
  additionalNames: readonly string[] = [],
): string[] {
  const names = new Set([
    ...request.cookies.getAll().map(({ name }) => name),
    ...additionalNames,
  ]);
  return [...names].filter((name) =>
    isHomeRelayAuthCookieName(name, supabaseUrl),
  );
}

function clearHomeRelayAuthResponseCookies(
  response: NextResponse,
  names: readonly string[],
): void {
  names.forEach((name) => {
    response.cookies.set(name, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  });
}

function redirectToLogin(
  request: NextRequest,
  cookies: readonly BufferedCookie[] = [],
  headers: ReadonlyMap<string, string> = new Map(),
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  const response = NextResponse.redirect(url);
  applyBufferedCookies(response, cookies);
  applyHeaders(response, headers);
  return makePrivate(response);
}

function rejectedSessionResponse(
  request: NextRequest,
  supabaseUrl: string,
  additionalCookieNames: readonly string[] = [],
): NextResponse {
  const names = homeRelayAuthCookieNames(
    request,
    supabaseUrl,
    additionalCookieNames,
  );
  // NextResponse serializes its downstream request override at construction
  // time, so mutate the request cookie jar before calling next().
  names.forEach((name) => request.cookies.set(name, ""));
  const response = isPublicPath(request.nextUrl.pathname)
    ? NextResponse.next({ request })
    : redirectToLogin(request);
  // A password Server Action will emit the newly authenticated cookies on
  // this same response. Its explicit success/failure path owns the browser
  // mutation; Proxy only strips stale credentials from the downstream request
  // to avoid an expiry/new-cookie header ordering race.
  if (!(request.nextUrl.pathname === "/login" && request.method === "POST")) {
    clearHomeRelayAuthResponseCookies(response, names);
  }
  return makePrivate(response);
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const config = getSupabasePublicConfig();
  if (!config) return NextResponse.next({ request });

  // This same-origin POST is the only bridge allowed to turn a freshly
  // verified device session into an HttpOnly active guard. Its route performs
  // the authoritative claims + membership check, so Proxy must leave the new
  // Supabase cookies intact until that check runs.
  if (
    request.nextUrl.pathname === DEVICE_SESSION_PATH &&
    request.method === "POST"
  ) {
    return makePrivate(NextResponse.next({ request }));
  }

  const guard = readSessionGuard(
    request.cookies.get(SESSION_GUARD_COOKIE_NAME)?.value,
  );
  if (guard.state === "signed-out") {
    return rejectedSessionResponse(request, config.url);
  }

  let pendingCookies: BufferedCookie[] = [];
  const pendingHeaders = new Map<string, string>();

  const supabase = createServerClient(config.url, config.publishableKey, {
    global: { fetch: createSupabaseAbortingFetch() },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Do not expose a refresh response until its JWT session_id has been
        // checked against the immutable request guard. In particular, Proxy
        // never writes the guard cookie, so an older response cannot replace a
        // later signed-out or newly active guard.
        pendingCookies = cookiesToSet;
        Object.entries(headers).forEach(([name, value]) => {
          pendingHeaders.set(name, value);
        });
      },
    },
  });

  let claimsResolution: ClaimsResolution;
  try {
    const result = await supabase.auth.getClaims();
    claimsResolution = classifyClaimsResult(result);
  } catch {
    claimsResolution = { state: "indeterminate" };
  }

  if (claimsResolution.state === "indeterminate") {
    // Provider, SDK, and network uncertainty must not turn a still-valid
    // session into a logout. Do not release buffered refresh cookies either:
    // their session_id has not been checked against the active guard.
    return indeterminateSessionResponse(request);
  }

  const claims =
    claimsResolution.state === "verified"
      ? claimsResolution.value.claims
      : null;
  const authenticated = claimsResolution.state === "verified";
  let guardAllowsCurrentSession: boolean;
  try {
    guardAllowsCurrentSession = await sessionGuardAllows(
      guard,
      sessionIdFromClaims(claims),
    );
  } catch {
    return indeterminateSessionResponse(request);
  }

  if (!authenticated || !guardAllowsCurrentSession) {
    if (guard.state === "active") {
      return rejectedSessionResponse(
        request,
        config.url,
        pendingCookies.map(({ name }) => name),
      );
    }

    // Legacy (guard-absent) sessions retain the existing compatibility path.
    // Cookie removals emitted by Supabase still reach the browser.
    if (!isPublicPath(request.nextUrl.pathname)) {
      return redirectToLogin(request, pendingCookies, pendingHeaders);
    }
  }

  pendingCookies.forEach(({ name, value }) => request.cookies.set(name, value));
  const response = NextResponse.next({ request });
  applyBufferedCookies(response, pendingCookies);
  applyHeaders(response, pendingHeaders);
  return makePrivate(response);
}
