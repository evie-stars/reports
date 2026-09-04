import { NextResponse, type NextRequest } from "next/server";
import { auth } from "../auth";
import { buildContentSecurityPolicy, generateNonce } from "@/lib/csp";

/**
 * Two jobs per request: next-auth's `authorized` callback gates access, then a fresh nonce is
 * minted and placed in both the request (so Next.js stamps it onto its own scripts during
 * rendering) and the response Content-Security-Policy header.
 *
 * When sign-in is disabled (local development only; production refuses to start this way) the
 * next-auth wrapper is skipped entirely so it does not demand OAuth configuration.
 */
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
  ? auth((request) => applyContentSecurityPolicy(request))
  : (request: NextRequest) => applyContentSecurityPolicy(request);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"]
};
