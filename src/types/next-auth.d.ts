import type { DefaultSession } from "next-auth";
import type { AppRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { role: AppRole; accessEnabled: boolean };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    accessEnabled?: boolean;
  }
}
