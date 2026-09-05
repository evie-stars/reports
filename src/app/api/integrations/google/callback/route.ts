import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-crypto";
import {
  droppedIntegrationProducts,
  exchangeGoogleAuthorizationCode,
  GOOGLE_INTEGRATION_PRODUCTS,
  GOOGLE_OAUTH_COOKIE_PATH,
  GOOGLE_OAUTH_PRODUCT_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  googleAccountForAccessToken,
  googleIntegrationsAppUrl,
  isGoogleIntegrationProduct
} from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const actor = await currentActor();
  if (actor.role !== "admin") return new Response("Administrator access is required.", { status: 403 });

  const returnedState = request.nextUrl.searchParams.get("state") ?? "";
  const storedState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? "";
  const storedProduct = request.cookies.get(GOOGLE_OAUTH_PRODUCT_COOKIE)?.value ?? "";
  const product = isGoogleIntegrationProduct(storedProduct) ? storedProduct : null;
  const definition = product ? GOOGLE_INTEGRATION_PRODUCTS[product] : null;
  const oauthError = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");

  try {
    if (oauthError) throw new Error(`Google connection was declined: ${oauthError}.`);
    if (!statesMatch(returnedState, storedState) || !product || !definition) {
      throw new Error("Google connection state was invalid or expired. Please try again.");
    }
    if (!code) throw new Error("Google did not return an authorization code.");

    const tokens = await exchangeGoogleAuthorizationCode(code);
    // Google lets the user untick individual scopes on the consent screen, and include_granted_scopes
    // can echo back an earlier grant for the other product, so the requested scope is checked by name.
    if (!tokens.grantedScopes.includes(definition.scope)) {
      throw new Error(`Read-only ${definition.label} access was not granted.`);
    }
    const accountEmail = await googleAccountForAccessToken(tokens.accessToken);
    const existing = await prisma.googleConnection.findUnique({ where: { accountEmail }, select: { grantedScopes: true } });
    // The response lists every scope the new refresh token can exercise, so it is stored verbatim.
    const dropped = droppedIntegrationProducts(existing?.grantedScopes ?? [], tokens.grantedScopes);
    const connection = await prisma.googleConnection.upsert({
      where: { accountEmail },
      create: {
        accountEmail,
        encryptedRefreshToken: encryptSecret(tokens.refreshToken),
        grantedScopes: tokens.grantedScopes,
        connectedByEmail: actor.email,
        lastValidatedAt: new Date()
      },
      update: {
        encryptedRefreshToken: encryptSecret(tokens.refreshToken),
        grantedScopes: tokens.grantedScopes,
        connectedByEmail: actor.email,
        connectedAt: new Date(),
        lastValidatedAt: new Date(),
        lastError: null
      }
    });
    await writeRequestAudit({
      event: `${definition.auditPrefix}.connected`,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: "googleConnection",
      entityId: connection.id,
      metadata: { accountEmail, grantedScopes: tokens.grantedScopes }
    });
    if (dropped.length > 0) {
      await writeRequestAudit({
        event: "google.scopes_reduced",
        outcome: "failure",
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: "googleConnection",
        entityId: connection.id,
        metadata: { accountEmail, droppedProducts: dropped }
      });
    }
    return settingsRedirect(request, { product, warning: dropped[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google account could not be connected.";
    await writeRequestAudit({
      event: "google.connection_failed",
      outcome: "failure",
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: "googleConnection",
      metadata: { product, error: message }
    });
    return settingsRedirect(request, { error: message });
  }
}

function statesMatch(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function settingsRedirect(
  request: NextRequest,
  outcome: { product?: string; warning?: string | null; error?: string }
) {
  const url = googleIntegrationsAppUrl("/settings");
  if (outcome.product) url.searchParams.set("google", outcome.product);
  if (outcome.warning) url.searchParams.set("googleWarning", outcome.warning);
  if (outcome.error) url.searchParams.set("googleError", outcome.error);
  const response = NextResponse.redirect(url);
  const expiredCookie = {
    expires: new Date(0),
    httpOnly: true,
    path: GOOGLE_OAUTH_COOKIE_PATH,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:"
  };
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", expiredCookie);
  response.cookies.set(GOOGLE_OAUTH_PRODUCT_COOKIE, "", expiredCookie);
  return response;
}
