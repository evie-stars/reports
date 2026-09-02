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
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ profile }) {
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : "";
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      return verified && emailAllowed(email);
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
