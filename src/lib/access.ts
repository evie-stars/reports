import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { isProduction } from "@/lib/env";
import { canManageReports, type AppRole } from "@/lib/roles";
import { assertAuthenticationConfigured } from "@/lib/startup-checks";

export { canManageReports };

export type CurrentActor = {
  email: string;
  name: string | null;
  role: AppRole;
};

export function authenticationEnabled() {
  return process.env.AUTH_ENABLED === "true";
}

export async function currentActor(): Promise<CurrentActor> {
  if (!authenticationEnabled()) {
    // Never hand out the local administrator identity on a production server.
    if (isProduction()) assertAuthenticationConfigured();
    return { email: "local-admin", name: "Local admin", role: "admin" };
  }

  const session = await auth();
  if (!session?.user?.email || session.user.accessEnabled === false) redirect("/login");
  return {
    email: session.user.email.toLowerCase(),
    name: session.user.name ?? null,
    role: session.user.role
  };
}

export async function requireAdmin() {
  const actor = await currentActor();
  if (actor.role !== "admin") throw new Error("Administrator access is required.");
  return actor;
}

export async function requireManager() {
  const actor = await currentActor();
  if (!canManageReports(actor.role)) throw new Error("Manager access is required.");
  return actor;
}
