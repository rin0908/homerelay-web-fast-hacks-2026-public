import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/env";
import {
  isHomeRelayAuthCookieName,
  SESSION_GUARD_COOKIE_NAME,
  SESSION_GUARD_COOKIE_OPTIONS,
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return noStore(new NextResponse(null, { status: 403 }));
  }

  const config = getSupabasePublicConfig();
  if (!config) {
    const response = NextResponse.redirect(new URL("/", request.url), 303);
    // Preserve the user's explicit logout intent even if a deployment is
    // temporarily missing its public Supabase configuration. If configuration
    // returns later, a stale auth cookie still cannot revive the session.
    response.cookies.set(
      SESSION_GUARD_COOKIE_NAME,
      signedOutSessionGuardValue(),
      SESSION_GUARD_COOKIE_OPTIONS,
    );
    return noStore(response);
  }

  const response =
    request.headers.get("x-homerelay-logout") === "fetch"
      ? new NextResponse(null, { status: 204 })
      : NextResponse.redirect(
          new URL("/login?loggedOut=1", request.url),
          303,
        );

  // This server-set HttpOnly marker is the authoritative logout boundary.
  // It is independent of React lifecycle and remains in force even if remote
  // revocation fails or an older in-flight response restores an auth cookie.
  response.cookies.set(
    SESSION_GUARD_COOKIE_NAME,
    signedOutSessionGuardValue(),
    SESSION_GUARD_COOKIE_OPTIONS,
  );
  request.cookies.getAll().forEach(({ name }) => {
    if (!isHomeRelayAuthCookieName(name, config.url)) return;
    response.cookies.set(name, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  });

  try {
    const supabase = await createClient();
    await supabase?.auth.signOut({ scope: "local" });
  } catch {
    // The guard and explicit cookie deletion already reject this browser's
    // session. Avoid exposing provider details; remote revocation is best-effort.
  }

  return noStore(response);
}
