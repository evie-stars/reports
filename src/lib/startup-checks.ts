import { isProduction } from "@/lib/env";

/**
 * Refuse to serve a production deployment that would hand every visitor an administrator
 * identity. Called once at server start from `instrumentation.ts`, and again defensively
 * whenever an actor is resolved with authentication disabled.
 */
export function assertAuthenticationConfigured(env: Record<string, string | undefined> = process.env) {
  if (!isProduction(env)) return;
  if (env.AUTH_ENABLED !== "true") {
    throw new Error("AUTH_ENABLED must be \"true\" in production. Refusing to start with authentication disabled.");
  }
  if (!env.AUTH_SECRET) {
    throw new Error("AUTH_SECRET must be set in production so sessions can be signed.");
  }
}
