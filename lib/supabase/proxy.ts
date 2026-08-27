import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/env";

const PUBLIC_PATHS = new Set(["/api/status", "/login", "/logout"]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/login/");
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

function redirectToLogin(
  request: NextRequest,
  supabaseResponse: NextResponse,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  const response = NextResponse.redirect(url);
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  return makePrivate(response);
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const config = getSupabasePublicConfig();
  if (!config) return NextResponse.next({ request });

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          supabaseResponse.headers.set(name, value);
        });
      },
    },
  });

  let authenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    authenticated =
      !error && typeof data?.claims?.sub === "string" && data.claims.sub.length > 0;
  } catch {
    authenticated = false;
  }

  if (!authenticated && !isPublicPath(request.nextUrl.pathname)) {
    return redirectToLogin(request, supabaseResponse);
  }

  return makePrivate(supabaseResponse);
}
