import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { encryptGscToken } from "@/lib/gsc-crypto";
import {
  exchangeGoogleSearchConsoleCode,
  googleAccountForAccessToken,
  googleSearchConsoleAppUrl,
  GSC_OAUTH_STATE_COOKIE,
  GSC_READONLY_SCOPE
} from "@/lib/google-search-console";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const actor = await currentActor();
  if (actor.role !== "admin") return new Response("Administrator access is required.", { status: 403 });

  const returnedState = request.nextUrl.searchParams.get("state") ?? "";
  const storedState = request.cookies.get(GSC_OAUTH_STATE_COOKIE)?.value ?? "";
  const oauthError = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");

  try {
    if (oauthError) throw new Error(`Google connection was declined: ${oauthError}.`);
    if (!statesMatch(returnedState, storedState)) throw new Error("Google connection state was invalid or expired. Please try again.");
    if (!code) throw new Error("Google did not return an authorization code.");

    const tokens = await exchangeGoogleSearchConsoleCode(code);
    if (!tokens.grantedScopes.includes(GSC_READONLY_SCOPE)) {
      throw new Error("Read-only Search Console access was not granted.");
    }
    const accountEmail = await googleAccountForAccessToken(tokens.accessToken);
    const connection = await prisma.googleSearchConsoleConnection.upsert({
      where: { accountEmail },
      create: {
        accountEmail,
        encryptedRefreshToken: encryptGscToken(tokens.refreshToken),
        grantedScopes: tokens.grantedScopes,
        connectedByEmail: actor.email,
        lastValidatedAt: new Date()
      },
      update: {
        encryptedRefreshToken: encryptGscToken(tokens.refreshToken),
        grantedScopes: tokens.grantedScopes,
        connectedByEmail: actor.email,
        connectedAt: new Date(),
        lastValidatedAt: new Date(),
        lastError: null
      }
    });
    await writeRequestAudit({
      event: "gsc.connected",
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: "gscConnection",
      entityId: connection.id,
      metadata: { accountEmail }
    });
    return settingsRedirect(request, "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Search Console could not be connected.";
    await writeRequestAudit({
      event: "gsc.connected",
      outcome: "failure",
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: "gscConnection",
      metadata: { error: message }
    });
    return settingsRedirect(request, null, message);
  }
}

function statesMatch(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function settingsRedirect(request: NextRequest, state: string | null, error?: string) {
  const url = googleSearchConsoleAppUrl("/settings");
  if (state) url.searchParams.set("gsc", state);
  if (error) url.searchParams.set("gscError", error);
  const response = NextResponse.redirect(url);
  response.cookies.set(GSC_OAUTH_STATE_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/api/integrations/google",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:"
  });
  return response;
}
