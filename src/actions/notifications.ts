"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { sendTestNotification as sendTestEmail } from "@/lib/notifications";
import { notificationTestRateLimit } from "@/lib/rate-limit";
import { auditAction, describeError, guardedAdminAction } from "@/actions/shared";

/** Email the signed-in administrator only, so outgoing mail can be checked before notifications are switched on. */
export async function sendTestNotification() {
  let outcome: { error: string } | null = null;
  try {
    // Every test opens a real SMTP session against the mail server, so it gets a small bucket of its own.
    const actor = await guardedAdminAction("notifications:test", notificationTestRateLimit());
    const result = await sendTestEmail(actor.email);
    await auditAction("notification.test", actor, "notification", null, { ok: result.ok, detail: result.message }, result.ok ? "success" : "failure");
    if (!result.ok) outcome = { error: result.message };
  } catch (error) {
    unstable_rethrow(error);
    outcome = { error: describeError(error, "The test email could not be sent.") };
  }
  redirect(outcome ? `/settings?notifyError=${encodeURIComponent(outcome.error)}` : "/settings?notify=sent");
}
