import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export type AppRole = "admin" | "sales";

const authEnabled = process.env.AUTH_ENABLED === "true";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: authEnabled
    ? [Google({
        clientId: process.env.AUTH_GOOGLE_ID ?? "",
        clientSecret: process.env.AUTH_GOOGLE_SECRET ?? ""
      })]
    : [],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ user, account, profile }) {
      if (account?.provider !== "google") return false;

      const googleProfile = profile as { email?: string; email_verified?: boolean } | undefined;
      const email = (googleProfile?.email ?? user.email ?? "").toLowerCase();
      const verified = googleProfile?.email_verified !== false;
      const allowed = verified && emailAllowed(email);

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
    jwt({ token }) {
      if (token.email) token.role = roleForEmail(token.email);
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.role = token.role === "admin" ? "admin" : "sales";
      return session;
    },
    authorized({ auth: session, request }) {
      if (!authEnabled) return true;
      const path = request.nextUrl.pathname;
      if (path === "/login" || path.startsWith("/share/") || path.startsWith("/api/auth/")) return true;
      return Boolean(session?.user);
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

function roleForEmail(email: string): AppRole {
  return envList("AUTH_ADMIN_EMAILS").includes(email.toLowerCase()) ? "admin" : "sales";
}

function envList(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
