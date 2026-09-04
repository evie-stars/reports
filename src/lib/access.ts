import { auth, type AppRole } from "../../auth";
import { redirect } from "next/navigation";

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
  if (actor.role === "team") throw new Error("Manager access is required.");
  return actor;
}

export function canManageReports(role: AppRole) {
  return role === "admin" || role === "manager";
}
