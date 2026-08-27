import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function noStore(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  if (!supabase) {
    return noStore(NextResponse.redirect(new URL("/", request.url), 303));
  }

  let failed = false;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    failed = Boolean(error);
  } catch {
    failed = true;
  }

  const destination = failed ? "/?logout=failed" : "/login?loggedOut=1";
  return noStore(
    NextResponse.redirect(new URL(destination, request.url), 303),
  );
}
