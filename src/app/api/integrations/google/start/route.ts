import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";
import {
  buildGoogleSearchConsoleAuthorizationUrl,
  googleSearchConsoleAppUrl,
  googleSearchConsoleConfigured,
  GSC_OAUTH_STATE_COOKIE
} from "@/lib/google-search-console";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const actor = await currentActor();
  if (actor.role !== "admin") return new Response("Administrator access is required.", { status: 403 });

  try {
    await enforceRateLimit("gsc:oauth", actor.email, { limit: 5, windowSeconds: 60 * 60 });
    if (!googleSearchConsoleConfigured()) throw new Error("Google Search Console credentials are not configured.");

    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(buildGoogleSearchConsoleAuthorizationUrl(state));
    response.cookies.set(GSC_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/api/integrations/google",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:"
    });
    await writeRequestAudit({
      event: "gsc.connection_started",
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: "gscConnection"
    });
    return response;
  } catch (error) {
    const message = error instanceof RateLimitError ? error.message : error instanceof Error ? error.message : "Unable to start Google connection.";
    return NextResponse.redirect(googleSearchConsoleAppUrl(`/settings?gscError=${encodeURIComponent(message)}`));
  }
}
