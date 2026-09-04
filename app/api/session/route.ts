import { NextResponse } from "next/server";

import { resolveCurrentSession } from "@/lib/supabase/session";
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
  try {
    const resolution = await resolveCurrentSession();
    if (resolution.state !== "verified") {
      const status =
        resolution.state === "unauthenticated"
          ? 401
          : resolution.state === "forbidden"
            ? 403
            : 503;
      return noStore(new NextResponse(null, { status }));
    }

    const { session } = resolution;

    const sessionFingerprint = await fingerprintSessionId(session.sessionId);
    if (!sessionFingerprint) {
      return noStore(new NextResponse(null, { status: 503 }));
    }

    return noStore(
      NextResponse.json({
        sessionFingerprint,
        userId: session.userId,
      }),
    );
  } catch {
    return noStore(new NextResponse(null, { status: 503 }));
  }
}
