import { getIntegrationStatus } from "@/lib/integration-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getIntegrationStatus(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
