"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import {
  canManageSecrets,
  confirmationRequired,
  dataForSeoAccountChange,
  environmentSecretValues,
  googleClientChange,
  isSecretName,
  markGoogleConnectionsForReconnect,
  NO_IDENTITY_CHANGE,
  recordVerification,
  removeSecret as removeStoredSecret,
  resolveSecret,
  rollbackSecret as rollbackStoredSecret,
  saveSecret as saveStoredSecret,
  SECRET_DEFINITIONS,
  storedSecretVersions,
  validateSecretValues,
  verifySecretValues,
  type IdentityChange,
  type SecretName
} from "@/lib/app-secrets";
import { plural } from "@/lib/format";
import { secretChangeRateLimit } from "@/lib/rate-limit";
import { auditAction, describeError, guardedAdminAction } from "@/actions/shared";

const MANAGE_DENIED = "Only administrators listed in AUTH_ADMIN_EMAILS can change API keys.";

type Outcome = { state: string } | { error: string };

/** Every key change is admin-only, rate-limited, and restricted to environment-listed administrators in production. */
async function secretActor(name: SecretName, scope: "secrets" | "secrets:verify" = "secrets") {
  const actor = await guardedAdminAction(scope, secretChangeRateLimit());
  if (!canManageSecrets(actor)) throw new Error(MANAGE_DENIED);
  return { actor, definition: SECRET_DEFINITIONS[name] };
}

export async function saveSecret(name: string, formData: FormData) {
  if (!isSecretName(name)) redirect("/settings");
  let outcome: Outcome;
  try {
    const { actor, definition } = await secretActor(name);
    const values = validateSecretValues(
      name,
      Object.fromEntries(definition.fields.map((field) => [field.key, formData.get(field.key)]))
    );

    // Paid DataForSEO tasks can only be collected by the account that posted them.
    const accountChange = name === "dataforseo" ? await dataForSeoAccountChange(values.login) : NO_IDENTITY_CHANGE;
    if (confirmationRequired(accountChange, formData.get("confirmAccountChange") === "on")) {
      throw new Error(`${accountChangeSentence(accountChange, "This login")} Wait for the worker to finish, or tick the confirmation to continue and lose them.`);
    }

    // Refresh tokens are bound to the issuing OAuth client, so a new client ID strands every connected account.
    const clientChange = name === "google-integrations" ? await googleClientChange(values.clientId) : NO_IDENTITY_CHANGE;
    if (confirmationRequired(clientChange, formData.get("confirmClientChange") === "on")) {
      throw new Error(`${clientChangeSentence(clientChange, "This client ID")} Tick the confirmation to continue.`);
    }

    // The new credentials are proven against the vendor before anything is stored.
    const verification = await verifySecretValues(name, values);
    if (!verification.ok && !verification.indeterminate) {
      await auditAction("secret.rejected", actor, "appSecret", name, { name, reason: verification.message }, "failure");
      throw new Error(verification.message);
    }
    const saved = await saveStoredSecret(name, values, actor.email, {
      verifiedAt: verification.ok ? new Date() : null,
      lastError: verification.ok ? null : verification.message
    });
    if (clientChange.changed !== false && clientChange.collateral > 0) await markGoogleConnectionsForReconnect();
    await auditAction("secret.saved", actor, "appSecret", name, {
      name,
      version: saved.version ?? 1,
      fingerprint: saved.fingerprint ?? "",
      verified: verification.ok,
      clientIdChanged: changeLabel(clientChange),
      loginChanged: changeLabel(accountChange)
    });
    outcome = { state: verification.ok ? "saved" : "saved-unverified" };
  } catch (error) {
    unstable_rethrow(error);
    outcome = { error: describeError(error, "The API key could not be saved.") };
  }
  finish(name, outcome);
}

export async function verifyStoredSecret(name: string) {
  if (!isSecretName(name)) redirect("/settings");
  let outcome: Outcome;
  try {
    // Checks get their own rate-limit bucket so a run of tests can never lock an admin out of rotating.
    const { actor, definition } = await secretActor(name, "secrets:verify");
    const { values, source } = await resolveSecret(name);
    if (!values) throw new Error(`No ${definition.label} credentials are configured.`);
    const verification = await verifySecretValues(name, values);
    // Only the stored row's own outcome is written back; an environment check never stamps the store.
    if (source === "app") await recordVerification(name, verification);
    await auditAction(
      verification.ok ? "secret.verified" : "secret.verification_failed",
      actor,
      "appSecret",
      name,
      { name, source, ...(verification.ok ? {} : { reason: verification.message }) },
      verification.ok ? "success" : "failure"
    );
    outcome = verification.ok ? { state: "verified" } : { error: verification.message };
  } catch (error) {
    unstable_rethrow(error);
    outcome = { error: describeError(error, "The API key could not be verified.") };
  }
  finish(name, outcome);
}

export async function rollbackSecret(name: string) {
  if (!isSecretName(name)) redirect("/settings");
  let outcome: Outcome;
  try {
    const { actor, definition } = await secretActor(name);
    const versions = await storedSecretVersions(name);
    if (!versions.hasPrevious) throw new Error(`There is no previous ${definition.label} version to roll back to.`);
    if (!versions.previous) throw new Error(`The previous ${definition.label} version cannot be decrypted, so it cannot be restored.`);

    // Rolling back is a switch like any other; the form (with its confirmation) is the only guarded way to make one.
    let change: IdentityChange = NO_IDENTITY_CHANGE;
    if (name === "dataforseo") {
      change = await dataForSeoAccountChange(versions.previous.login, versions.current?.login ?? null);
      if (confirmationRequired(change, false)) {
        throw new Error(`${accountChangeSentence(change, "The previous version")} Wait for the worker to finish, or save those credentials through the form with the confirmation ticked.`);
      }
    }
    if (name === "google-integrations") {
      change = await googleClientChange(versions.previous.clientId, versions.current?.clientId ?? null);
      if (confirmationRequired(change, false)) {
        throw new Error(`${clientChangeSentence(change, "The previous version")} Save those credentials through the form with the confirmation ticked instead.`);
      }
    }

    const restored = await rollbackStoredSecret(name, actor.email);
    await auditAction("secret.rolled_back", actor, "appSecret", name, {
      name,
      version: restored.version ?? 0,
      fingerprint: restored.fingerprint ?? "",
      identityChanged: changeLabel(change)
    });
    outcome = { state: "rolled-back" };
  } catch (error) {
    unstable_rethrow(error);
    outcome = { error: describeError(error, "The previous API key could not be restored.") };
  }
  finish(name, outcome);
}

export async function removeSecret(name: string) {
  if (!isSecretName(name)) redirect("/settings");
  let outcome: Outcome;
  try {
    const { actor } = await secretActor(name);
    const versions = await storedSecretVersions(name);
    const environment = environmentSecretValues(name);

    // Removal switches to the environment value, so it gets the same guard as saving that value would.
    let change: IdentityChange = NO_IDENTITY_CHANGE;
    if (environment && name === "dataforseo") {
      change = await dataForSeoAccountChange(environment.login, versions.current?.login ?? null);
      if (confirmationRequired(change, false)) {
        throw new Error(`${accountChangeSentence(change, "The server environment login")} Wait for the worker to finish, or save the environment credentials through the form with the confirmation ticked.`);
      }
    }
    if (environment && name === "google-integrations") {
      change = await googleClientChange(environment.clientId, versions.current?.clientId ?? null);
      if (confirmationRequired(change, false)) {
        throw new Error(`${clientChangeSentence(change, "The server environment client ID")} Save the environment credentials through the form with the confirmation ticked instead.`);
      }
    }

    const removed = await removeStoredSecret(name);
    if (!removed) throw new Error("No API key is stored in the app for this service.");
    await auditAction("secret.removed", actor, "appSecret", name, { name, identityChanged: changeLabel(change) });
    outcome = { state: "removed" };
  } catch (error) {
    unstable_rethrow(error);
    outcome = { error: describeError(error, "The API key could not be removed.") };
  }
  finish(name, outcome);
}

function accountChangeSentence(change: IdentityChange, subject: string) {
  const relation = change.changed === null ? "may belong to a different DataForSEO account than the one in use" : "belongs to a different DataForSEO account than the one in use";
  const verb = change.collateral === 1 ? "has" : "have";
  return `${subject} ${relation}, and ${plural(change.collateral, "paid task")} submitted under the current account ${verb} not been collected yet.`;
}

function clientChangeSentence(change: IdentityChange, subject: string) {
  const relation = change.changed === null ? "may be a different Google client than the one in use" : "is a different Google client than the one in use";
  return `${subject} ${relation}, so ${plural(change.collateral, "connected Google account")} would have to reconnect.`;
}

function changeLabel(change: IdentityChange) {
  return change.changed === null ? "unknown" : change.changed ? "yes" : "no";
}

function finish(name: SecretName, outcome: Outcome): never {
  revalidatePath("/settings");
  const params = new URLSearchParams({ secretName: name });
  if ("error" in outcome) params.set("secretError", outcome.error);
  else params.set("secret", outcome.state);
  redirect(`/settings?${params.toString()}#api-keys`);
}
