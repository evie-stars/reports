"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { importRankHistoryCsv } from "@/lib/rank-history-import";
import { actionRateLimit, shareRateLimit } from "@/lib/rate-limit";
import { buildReportSnapshot, reportSnapshotSlug } from "@/lib/report-snapshot";
import {
  auditAction,
  describeError,
  guardedAdminAction,
  guardedManagerAction,
  optionalText,
  readForm,
  SHARE_EXPIRY_DAYS,
  shareExpiry,
  stringFromForm,
  stringListFromForm
} from "@/actions/shared";

const clientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required."),
  notes: optionalText
});

const reportSnapshotSchema = z.object({
  snapshotModules: z.array(z.enum(["rankings", "maps", "gsc"])).min(1, "Select at least one snapshot section."),
  shareExpiryDays: z.coerce.number().int().refine((value) => (SHARE_EXPIRY_DAYS as readonly number[]).includes(value), "Choose a valid link lifetime.")
});

export async function createClient(formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = clientSchema.parse(readForm(formData, ["name", "notes"]));
  const client = await prisma.client.create({ data });
  await auditAction("client.created", actor, "client", client.id);

  revalidatePath("/clients");
  redirect(`/clients/${client.id}?view=settings`);
}

export async function updateClient(clientId: string, formData: FormData) {
  const actor = await guardedManagerAction("mutation", actionRateLimit());
  const data = clientSchema.parse(readForm(formData, ["name", "notes"]));
  await prisma.client.update({ where: { id: clientId }, data });
  await auditAction("client.updated", actor, "client", clientId);

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function importRankHistory(formData: FormData) {
  const actor = await guardedAdminAction("mutation", actionRateLimit());
  let clientId: string;

  try {
    const file = formData.get("historyFile");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a historical ranking CSV to import.");
    if (file.size > 900 * 1024) throw new Error("The CSV must be smaller than 900 KB.");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("The historical ranking file must be a CSV.");

    const result = await importRankHistoryCsv(await file.text(), {
      clientName: stringFromForm(formData.get("clientName")),
      projectName: stringFromForm(formData.get("projectName"))
    });
    clientId = result.clientId;
    await auditAction("client.history_imported", actor, "client", result.clientId, {
      projectId: result.projectId,
      keywordCount: result.keywordCount,
      resultCount: result.resultCount
    });
  } catch (error) {
    const message = describeError(error, "Unable to import the historical rankings.");
    await auditAction("client.history_imported", actor, "client", null, { error: message }, "failure");
    redirect(`/clients?import=1&importError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/");
  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function enableClientShare(clientId: string, formData?: FormData) {
  const actor = await guardedAdminAction("share", shareRateLimit());
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new Error("Client not found.");
  const expiresAt = shareExpiry(formData);

  await prisma.client.update({
    where: { id: clientId },
    data: {
      shareEnabled: true,
      shareToken: randomBytes(24).toString("base64url"),
      shareCreatedAt: new Date(),
      shareExpiresAt: expiresAt,
      shareRevokedAt: null
    }
  });
  await auditAction("client.share_created", actor, "client", clientId, { expiresAt: expiresAt.toISOString() });
  revalidatePath(`/clients/${clientId}`);
}

export async function disableClientShare(clientId: string) {
  const actor = await guardedAdminAction("share", shareRateLimit());
  await prisma.client.update({
    where: { id: clientId },
    data: { shareEnabled: false, shareToken: null, shareExpiresAt: null, shareRevokedAt: new Date() }
  });
  await auditAction("client.share_revoked", actor, "client", clientId);
  revalidatePath(`/clients/${clientId}`);
}

export async function regenerateClientShare(clientId: string, formData: FormData) {
  const actor = await guardedAdminAction("share", shareRateLimit());
  const expiresAt = shareExpiry(formData);
  await prisma.client.update({
    where: { id: clientId },
    data: {
      shareEnabled: true,
      shareToken: randomBytes(24).toString("base64url"),
      shareCreatedAt: new Date(),
      shareExpiresAt: expiresAt,
      shareRevokedAt: null
    }
  });
  await auditAction("client.share_regenerated", actor, "client", clientId, { expiresAt: expiresAt.toISOString() });
  revalidatePath(`/clients/${clientId}`);
}

export async function createReportSnapshot(clientId: string, formData: FormData) {
  const actor = await guardedManagerAction("share", shareRateLimit());
  const data = reportSnapshotSchema.parse({
    snapshotModules: stringListFromForm(formData, "snapshotModules"),
    shareExpiryDays: formData.get("shareExpiryDays")
  });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) throw new Error("Client not found.");

  const payload = await buildReportSnapshot(client.id, data.snapshotModules);
  const expiresAt = new Date(Date.now() + data.shareExpiryDays * 24 * 60 * 60 * 1000);
  const snapshot = await prisma.reportSnapshot.create({
    data: {
      clientId: client.id,
      slug: reportSnapshotSlug(client.name),
      token: randomBytes(32).toString("base64url"),
      modules: data.snapshotModules,
      payload,
      expiresAt,
      createdByEmail: actor.email
    }
  });
  await auditAction("report_snapshot.created", actor, "reportSnapshot", snapshot.id, {
    clientId: client.id,
    modules: data.snapshotModules,
    expiresAt: expiresAt.toISOString()
  });
  revalidatePath(`/clients/${client.id}`);
}

export async function regenerateReportSnapshot(snapshotId: string, formData: FormData) {
  const actor = await guardedManagerAction("share", shareRateLimit());
  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id: snapshotId },
    include: { client: { select: { id: true, name: true } } }
  });
  if (!snapshot) throw new Error("Snapshot not found.");

  const expiresAt = shareExpiry(formData);
  const modules = snapshot.modules.filter((module): module is "rankings" | "maps" | "gsc" => module !== "ga4");
  const payload = await buildReportSnapshot(snapshot.clientId, modules);
  const [, replacement] = await prisma.$transaction([
    prisma.reportSnapshot.update({ where: { id: snapshot.id }, data: { revokedAt: new Date() } }),
    prisma.reportSnapshot.create({
      data: {
        clientId: snapshot.clientId,
        slug: reportSnapshotSlug(snapshot.client.name),
        token: randomBytes(32).toString("base64url"),
        modules: snapshot.modules,
        payload,
        expiresAt,
        createdByEmail: actor.email
      }
    })
  ]);
  await auditAction("report_snapshot.regenerated", actor, "reportSnapshot", replacement.id, {
    clientId: snapshot.clientId,
    modules,
    expiresAt: expiresAt.toISOString(),
    replacedSnapshotId: snapshot.id
  });
  revalidatePath(`/clients/${snapshot.clientId}`);
}

export async function revokeReportSnapshot(snapshotId: string) {
  const actor = await guardedManagerAction("share", shareRateLimit());
  const snapshot = await prisma.reportSnapshot.findUnique({ where: { id: snapshotId }, select: { id: true, clientId: true } });
  if (!snapshot) throw new Error("Snapshot not found.");

  await prisma.reportSnapshot.update({ where: { id: snapshot.id }, data: { revokedAt: new Date() } });
  await auditAction("report_snapshot.revoked", actor, "reportSnapshot", snapshot.id, { clientId: snapshot.clientId });
  revalidatePath(`/clients/${snapshot.clientId}`);
}
