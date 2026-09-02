import { NextResponse } from "next/server";
import { DataForSeoClient } from "@/lib/dataforseo";
import { currentActor } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET() {
  await currentActor();

  try {
    const locations = await new DataForSeoClient().getGoogleLocations("gb");
    return NextResponse.json({ locations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load supported areas.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
