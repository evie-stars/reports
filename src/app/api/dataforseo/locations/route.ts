import { NextResponse } from "next/server";
import { DataForSeoClient } from "@/lib/dataforseo";
import { currentActor } from "@/lib/access";
import { apiRateLimit, enforceRateLimit, RateLimitError } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await currentActor();

  try {
    await enforceRateLimit("api:locations", actor.email, apiRateLimit());
    const locations = await new DataForSeoClient().getGoogleLocations("gb");
    return NextResponse.json({ locations });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      );
    }
    const message = error instanceof Error ? error.message : "Unable to load supported areas.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
