import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";

export type AppRole = "admin" | "manager" | "team";

const authEnabled = process.env.AUTH_ENABLED === "true";
const sessionMaxAgeSeconds = positiveInteger(process.env.AUTH_SESSION_MAX_AGE_HOURS, 10) * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: authEnabled
    ? [Google({
        clientId: process.env.AUTH_GOOGLE_ID ?? "",
        clientSecret: process.env.AUTH_GOOGLE_SECRET ?? ""
      })]
    : [],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: sessionMaxAgeSeconds },
  jwt: { maxAge: sessionMaxAgeSeconds },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return false;

      const googleProfile = profile as { email?: string; email_verified?: boolean } | undefined;
      const email = (googleProfile?.email ?? user.email ?? "").toLowerCase();
      const verified = googleProfile?.email_verified !== false;
      const access = await resolveUserAccess(email);
      const allowed = verified && access.allowed;

      try {
        await enforceRateLimit("auth:google", email || "missing-email", { limit: 20, windowSeconds: 15 * 60 });
      } catch (error) {
        await writeAuditLog({
          event: "auth.sign_in",
          outcome: "failure",
          actorEmail: email || null,
          metadata: { reason: error instanceof RateLimitError ? "rate_limited" : "rate_limit_unavailable" }
        });
        return false;
      }

      await writeAuditLog({
        event: "auth.sign_in",
        outcome: allowed ? "success" : "failure",
        actorEmail: email || null,
        actorRole: allowed ? access.role : null,
        metadata: { reason: allowed ? "approved" : verified ? "not_allowlisted" : "unverified_email" }
      });

      if (allowed) await recordSuccessfulSignIn(email, user.name ?? null, access.role);

      if (!allowed) {
        console.warn("[auth] Google sign-in rejected", {
          email,
          verified,
          allowedDomainsConfigured: envList("AUTH_ALLOWED_DOMAINS").length > 0,
          allowedEmailsConfigured: envList("AUTH_ALLOWED_EMAILS").length > 0
        });
      }

      return allowed;
    },
    async jwt({ token }) {
      if (token.email) {
        const access = await resolveUserAccess(token.email);
        token.role = access.role;
        token.accessEnabled = access.allowed;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role === "admin" || token.role === "manager" ? token.role : "team";
        session.user.accessEnabled = token.accessEnabled !== false;
      }
      return session;
    },
    authorized({ auth: session, request }) {
      if (!authEnabled) return true;
      const path = request.nextUrl.pathname;
      if (path === "/login" || path.startsWith("/share/") || path.startsWith("/api/auth/")) return true;
      return Boolean(session?.user && session.user.accessEnabled !== false);
    }
  }
});

function emailAllowed(email: string) {
  if (!email) return false;
  const emails = envList("AUTH_ALLOWED_EMAILS");
  const domains = envList("AUTH_ALLOWED_DOMAINS");
  const domain = email.split("@")[1] ?? "";
  return emails.includes(email) || domains.includes(domain);
}

async function resolveUserAccess(email: string): Promise<{ allowed: boolean; role: AppRole }> {
  const normalizedEmail = email.toLowerCase();
  if (!normalizedEmail) return { allowed: false, role: "team" };

  // Environment admins remain a recovery path if the database or dashboard access is unavailable.
  if (envList("AUTH_ADMIN_EMAILS").includes(normalizedEmail)) return { allowed: true, role: "admin" };

  try {
    const userAccess = await prisma.userAccess.findUnique({ where: { email: normalizedEmail } });
    if (userAccess) return { allowed: userAccess.enabled, role: userAccess.role };
  } catch (error) {
    console.error("[auth] Unable to read managed user access", error);
  }

  const role = envList("AUTH_MANAGER_EMAILS").includes(normalizedEmail) ? "manager" : "team";
  return { allowed: emailAllowed(normalizedEmail), role };
}

async function recordSuccessfulSignIn(email: string, name: string | null, role: AppRole) {
  try {
    const bootstrapAdmin = envList("AUTH_ADMIN_EMAILS").includes(email);
    await prisma.userAccess.upsert({
      where: { email },
      create: { email, name, role, enabled: true, lastSignInAt: new Date() },
      update: {
        ...(name ? { name } : {}),
        ...(bootstrapAdmin ? { role: "admin", enabled: true } : {}),
        lastSignInAt: new Date()
      }
    });
  } catch (error) {
    console.error("[auth] Unable to update managed user access", error);
  }
}

function envList(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
