"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { envList } from "@/lib/env";
import { actionRateLimit } from "@/lib/rate-limit";
import { isBootstrapAdmin } from "@/lib/user-access";
import { auditAction, guardedAdminAction, readForm } from "@/actions/shared";

const userAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z.string().trim().max(100).optional().transform((value) => value || null),
  role: z.enum(["admin", "manager", "team"])
});

const userRoleSchema = z.object({ role: z.enum(["admin", "manager", "team"]) });

export async function createUserAccess(formData: FormData) {
  const actor = await guardedAdminAction("user-access", actionRateLimit());
  const data = userAccessSchema.parse(readForm(formData, ["email", "name", "role"]));
  const role = isBootstrapAdmin(data.email) ? "admin" : data.role;
  const userAccess = await prisma.userAccess.upsert({
    where: { email: data.email },
    create: { ...data, role, enabled: true },
    update: { name: data.name, role, enabled: true }
  });

  await auditAction("user_access.saved", actor, "userAccess", userAccess.id, { email: userAccess.email, role: userAccess.role });
  revalidatePath("/");
}

export async function updateUserAccessRole(userAccessId: string, formData: FormData) {
  const actor = await guardedAdminAction("user-access", actionRateLimit());
  const { role } = userRoleSchema.parse(readForm(formData, ["role"]));
  const target = await prisma.userAccess.findUniqueOrThrow({ where: { id: userAccessId } });
  if (isBootstrapAdmin(target.email)) throw new Error("Environment administrators must be changed in Plesk.");
  if (target.role === "admin" && role !== "admin") await requireAnotherAdministrator(target.id, target.email);

  await prisma.userAccess.update({ where: { id: target.id }, data: { role } });
  await auditAction("user_access.role_changed", actor, "userAccess", target.id, { email: target.email, previousRole: target.role, role });
  revalidatePath("/");
}

export async function toggleUserAccess(userAccessId: string) {
  const actor = await guardedAdminAction("user-access", actionRateLimit());
  const target = await prisma.userAccess.findUniqueOrThrow({ where: { id: userAccessId } });
  if (isBootstrapAdmin(target.email)) throw new Error("Environment administrators cannot be disabled here.");
  if (target.email === actor.email && target.enabled) throw new Error("You cannot disable your own account.");
  if (target.enabled && target.role === "admin") await requireAnotherAdministrator(target.id, target.email);

  const updated = await prisma.userAccess.update({ where: { id: target.id }, data: { enabled: !target.enabled } });
  await auditAction(updated.enabled ? "user_access.enabled" : "user_access.disabled", actor, "userAccess", target.id, {
    email: target.email,
    role: target.role
  });
  revalidatePath("/");
}

async function requireAnotherAdministrator(userAccessId: string, email: string) {
  const databaseAdmins = await prisma.userAccess.count({ where: { id: { not: userAccessId }, role: "admin", enabled: true } });
  const environmentAdmins = envList("AUTH_ADMIN_EMAILS").filter((adminEmail) => adminEmail !== email.toLowerCase()).length;
  if (databaseAdmins + environmentAdmins === 0) throw new Error("At least one active administrator must remain.");
}
