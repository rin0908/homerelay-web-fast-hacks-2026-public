import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/supabase/session";
import { fingerprintSessionId } from "@/lib/supabase/session-guard";

function noStore(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) return noStore(new NextResponse(null, { status: 401 }));

  const sessionFingerprint = await fingerprintSessionId(session.sessionId);
  if (!sessionFingerprint) {
    return noStore(new NextResponse(null, { status: 401 }));
  }

  return noStore(
    NextResponse.json({
      sessionFingerprint,
      userId: session.userId,
    }),
  );
}
