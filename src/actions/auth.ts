"use server";

import { signIn, signOut } from "../../auth";
import { currentActor } from "@/lib/access";
import { writeRequestAudit } from "@/lib/audit";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutAction() {
  const actor = await currentActor();
  await writeRequestAudit({ event: "auth.sign_out", actorEmail: actor.email, actorRole: actor.role });
  await signOut({ redirectTo: "/login" });
}
