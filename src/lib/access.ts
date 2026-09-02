import { auth, type AppRole } from "../../auth";

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
  if (!session?.user?.email) throw new Error("You must sign in to continue.");
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
