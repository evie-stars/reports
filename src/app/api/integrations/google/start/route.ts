import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";
import {
  buildGoogleAuthorizationUrl,
  GOOGLE_INTEGRATION_PRODUCTS,
  GOOGLE_OAUTH_COOKIE_PATH,
  GOOGLE_OAUTH_PRODUCT_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  googleIntegrationsAppUrl,
  googleIntegrationsConfigured,
  isGoogleIntegrationProduct
} from "@/lib/google-oauth";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Begin a Google consent flow for one reporting product (`?product=search-console` by default, or
 * `?product=analytics`). The product is remembered in a cookie alongside the CSRF state so the
 * callback can insist that the scope actually asked for was the one granted.
 */
export async function GET(request: NextRequest) {
  const actor = await currentActor();
  if (actor.role !== "admin") return new Response("Administrator access is required.", { status: 403 });

  const requestedProduct = request.nextUrl.searchParams.get("product") ?? "search-console";
  const product = isGoogleIntegrationProduct(requestedProduct) ? requestedProduct : null;

  try {
    await enforceRateLimit("google:oauth", actor.email, { limit: 5, windowSeconds: 60 * 60 });
    if (!product) throw new Error("Unknown Google integration.");
    if (!googleIntegrationsConfigured()) throw new Error("Google integration credentials are not configured.");

    const definition = GOOGLE_INTEGRATION_PRODUCTS[product];
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state, [definition.scope]));
    const cookieOptions = {
      httpOnly: true,
      maxAge: 10 * 60,
      path: GOOGLE_OAUTH_COOKIE_PATH,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:"
    };
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, cookieOptions);
    response.cookies.set(GOOGLE_OAUTH_PRODUCT_COOKIE, product, cookieOptions);
    await writeRequestAudit({
      event: `${definition.auditPrefix}.connection_started`,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: "googleConnection"
    });
    return response;
  } catch (error) {
    const message = error instanceof RateLimitError ? error.message : error instanceof Error ? error.message : "Unable to start Google connection.";
    return NextResponse.redirect(googleIntegrationsAppUrl(`/settings?googleError=${encodeURIComponent(message)}`));
  }
}
