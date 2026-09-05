import { NextResponse, type NextRequest } from "next/server";
import { auth } from "../auth";
import { buildContentSecurityPolicy, generateNonce } from "@/lib/csp";
import { enforceRateLimit, RateLimitError, shareViewRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request-ip";

/**
 * Three jobs per request: next-auth's `authorized` callback gates access, the public `/share/*`
 * pages are rate limited per caller address, then a fresh nonce is minted and placed in both the
 * request (so Next.js stamps it onto its own scripts during rendering) and the response
 * Content-Security-Policy header.
 *
 * When sign-in is disabled (local development only; production refuses to start this way) the
 * next-auth wrapper is skipped entirely so it does not demand OAuth configuration.
 */
async function handleRequest(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/share/")) {
    const rejected = await shareRateLimitResponse(request);
    if (rejected) return rejected;
  }
  return applyContentSecurityPolicy(request);
}

/**
 * Read-only share links are bearer links reachable without an account, so each caller address gets
 * a fixed budget of page views. A limiter that cannot reach the database lets the request through:
 * the page behind it needs the database too and will fail on its own.
 */
async function shareRateLimitResponse(request: NextRequest) {
  const address = clientIpFromHeaders(request.headers) ?? "unknown";
  try {
    await enforceRateLimit("share:view", address, shareViewRateLimit());
    return null;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return new NextResponse("Too many requests for this report link. Please try again shortly.", {
        status: 429,
        headers: {
          "Retry-After": String(error.retryAfterSeconds),
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    }
    console.warn("[share] Rate limit check failed; allowing the request", error);
    return null;
  }
}

function applyContentSecurityPolicy(request: NextRequest) {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const proxy = process.env.AUTH_ENABLED === "true"
  ? auth((request) => handleRequest(request))
  : (request: NextRequest) => handleRequest(request);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"]
};
