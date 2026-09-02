import type { DefaultSession } from "next-auth";
import type { AppRole } from "../../auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { role: AppRole };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
  }
}
