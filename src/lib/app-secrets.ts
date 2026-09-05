import type { AppSecret, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchWithTimeout, readJsonResponse } from "@/lib/http";
import { importLockHeld } from "@/lib/import-lock";
import { decryptSecret, encryptSecret, fingerprintSecret, MASTER_KEY_ENV } from "@/lib/secret-crypto";
import { isBootstrapAdmin } from "@/lib/user-access";
import type { AppRole } from "@/lib/roles";

/**
 * API credentials managed from Settings. Values are stored encrypted, resolved with the app store
 * taking precedence over the server environment, and never handed to a browser: pages only ever
 * see a fingerprint and a non-secret display hint.
 */

export const SECRET_NAMES = ["dataforseo", "google-integrations"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export type SecretField = {
  key: string;
  label: string;
  /** Rendered as a password input. Non-secret fields are still never echoed back. */
  secret: boolean;
  envName: string;
  placeholder?: string;
};

export type SecretDefinition = {
  name: SecretName;
  label: string;
  description: string;
  fields: SecretField[];
  /** The field that identifies the account or client; changing it has consequences beyond the credential itself. */
  identityField: string;
  hint: (values: SecretValues) => string;
};

export type SecretValues = Record<string, string>;
export type SecretSource = "app" | "environment" | "missing";

export type SecretSummary = {
  name: SecretName;
  label: string;
  configured: boolean;
  source: SecretSource;
  displayHint: string | null;
  fingerprint: string | null;
  version: number | null;
  updatedByEmail: string | null;
  savedAt: Date | null;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  hasPrevious: boolean;
  previousDisplayHint: string | null;
  previousSavedAt: Date | null;
  /** APP_SECRETS_SOURCE=environment is set: the store is ignored and cannot be changed. */
  locked: boolean;
  /** The store itself could not be read (database down, table missing); nothing is usable until it recovers. */
  unavailable: boolean;
  /** A readable stored value exists and differs from what the server environment holds. */
  overridesEnvironment: boolean;
  /** The server environment holds a complete value (used after "Remove from app"). */
  environmentConfigured: boolean;
};

export type ResolvedSecret = {
  values: SecretValues | null;
  source: SecretSource;
};

export type VerificationResult = {
  ok: boolean;
  /** True when the vendor could not be reached or answered unexpectedly, so nothing was proven either way. */
  indeterminate: boolean;
  message: string;
};

/**
 * Whether switching to a candidate identity (DataForSEO login, Google client ID) differs from the one in
 * use, and how much would be lost: paid tasks awaiting collection, or connected accounts whose refresh
 * tokens would die. `changed` is null when the current value could not be read, which must be treated
 * as a possible change.
 */
export type IdentityChange = { changed: boolean | null; collateral: number };

export const NO_IDENTITY_CHANGE: IdentityChange = { changed: false, collateral: 0 };

export const SECRET_DEFINITIONS: Record<SecretName, SecretDefinition> = {
  dataforseo: {
    name: "dataforseo",
    label: "DataForSEO",
    description: "API login and password from the DataForSEO dashboard. Used by every rank check and keyword metrics task.",
    fields: [
      { key: "login", label: "API login", secret: false, envName: "DATAFORSEO_LOGIN", placeholder: "name@company.co.uk" },
      { key: "password", label: "API password", secret: true, envName: "DATAFORSEO_PASSWORD" }
    ],
    identityField: "login",
    hint: (values) => maskIdentifier(values.login)
  },
  "google-integrations": {
    name: "google-integrations",
    label: "Google integrations client",
    description: "The read-only OAuth client shared by Search Console and Google Analytics. Connected accounts keep working after a rotation as long as the client ID is unchanged.",
    fields: [
      { key: "clientId", label: "OAuth client ID", secret: false, envName: "GOOGLE_SEARCH_CONSOLE_CLIENT_ID", placeholder: "…apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth client secret", secret: true, envName: "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET" }
    ],
    identityField: "clientId",
    hint: (values) => values.clientId
  }
};

const CACHE_TTL_MS = 30 * 1000;
const cache = new Map<SecretName, { expiresAt: number; resolved: ResolvedSecret }>();

/** Incident-response switch: when set to "environment" the store is ignored and rotation forms are disabled. */
export const SECRETS_SOURCE_ENV = "APP_SECRETS_SOURCE";
/** SystemLock key held by the rekey script so no save can land under the old master key. */
export const SECRETS_REKEY_LOCK_KEY = "secrets-rekey";

export function secretStoreLocked(env: Record<string, string | undefined> = process.env) {
  return env[SECRETS_SOURCE_ENV]?.trim().toLowerCase() === "environment";
}

export function isSecretName(value: unknown): value is SecretName {
  return typeof value === "string" && (SECRET_NAMES as readonly string[]).includes(value);
}

/** Only administrators listed in AUTH_ADMIN_EMAILS may change keys; local development (sign-in off) allows the local admin. */
export function canManageSecrets(actor: { role: AppRole; email: string }, env: Record<string, string | undefined> = process.env) {
  if (actor.role !== "admin") return false;
  if (env.AUTH_ENABLED !== "true") return true;
  return isBootstrapAdmin(actor.email, env);
}

export type ResolveDependencies = {
  loadRow: (name: SecretName) => Promise<Pick<AppSecret, "encryptedValue"> | null>;
  env: Record<string, string | undefined>;
  masterKey?: string;
};

/**
 * Decide which values apply: the app store wins, then the environment, then nothing. A store that
 * cannot be read or decrypted is an error, never a fallback: after an in-app rotation the environment
 * usually holds the revoked credentials, and using them would fail paid tasks permanently.
 */
export async function resolveSecretWith(name: SecretName, deps: ResolveDependencies): Promise<ResolvedSecret> {
  const definition = SECRET_DEFINITIONS[name];
  let row: Pick<AppSecret, "encryptedValue"> | null = null;
  if (!secretStoreLocked(deps.env)) {
    try {
      row = await deps.loadRow(name);
    } catch (error) {
      throw new Error(`The API key store could not be read for ${definition.label}: ${error instanceof Error ? error.message : "database unavailable"}`);
    }
  }

  if (row) {
    const values = readStoredValues(definition, row.encryptedValue, deps.masterKey);
    if (!values) throw new Error(unreadableMessage(definition));
    return { values, source: "app" };
  }

  const envValues = environmentValues(definition, deps.env);
  return envValues ? { values: envValues, source: "environment" } : { values: null, source: "missing" };
}

export async function resolveSecret(name: SecretName): Promise<ResolvedSecret> {
  const cached = cache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.resolved;
  const resolved = await resolveSecretWith(name, {
    loadRow: (secretName) => prisma.appSecret.findUnique({ where: { name: secretName }, select: { encryptedValue: true } }),
    env: process.env
  });
  cache.set(name, { expiresAt: Date.now() + CACHE_TTL_MS, resolved });
  return resolved;
}

export function invalidateSecretCache(name?: SecretName) {
  if (name) cache.delete(name);
  else cache.clear();
}

export function environmentSecretValues(name: SecretName, env: Record<string, string | undefined> = process.env) {
  return environmentValues(SECRET_DEFINITIONS[name], env);
}

export async function secretStatus(name: SecretName, env: Record<string, string | undefined> = process.env): Promise<SecretSummary> {
  const definition = SECRET_DEFINITIONS[name];
  const envValues = environmentValues(definition, env);
  const locked = secretStoreLocked(env);
  if (locked) return { ...summarise(definition, null, Boolean(envValues)), locked: true };

  let row: AppSecret | null = null;
  try {
    row = await prisma.appSecret.findUnique({ where: { name } });
  } catch (error) {
    console.warn(`[secrets] Unable to read the ${definition.label} status`, error);
    // Mirror resolveSecret: an unreadable store means nothing is usable, not "the environment is in use".
    return {
      ...summarise(definition, null, Boolean(envValues)),
      configured: false,
      source: "missing",
      unavailable: true,
      lastError: `The API key store could not be read: ${error instanceof Error ? error.message : "database unavailable"}`
    };
  }

  const stored = row ? readStoredValues(definition, row.encryptedValue) : null;
  const summary = summarise(definition, row, Boolean(envValues));
  if (row && !stored) {
    return {
      ...summary,
      configured: false,
      lastError: `The stored value cannot be decrypted with the current ${MASTER_KEY_ENV}. Save the credentials again or run the rekey script.`
    };
  }
  if (stored && envValues) {
    // Compared on the decrypted values so the answer stays right while a previous master key is still in play.
    return { ...summary, overridesEnvironment: canonicalValues(definition, envValues) !== canonicalValues(definition, stored) };
  }
  return summary;
}

export async function allSecretStatuses(env: Record<string, string | undefined> = process.env) {
  return Promise.all(SECRET_NAMES.map((name) => secretStatus(name, env)));
}

/** True while `npm run secrets:rekey` holds its lock; writes must wait so nothing is stored under the old key. */
export async function rekeyInProgress() {
  try {
    return await importLockHeld(SECRETS_REKEY_LOCK_KEY);
  } catch {
    return false;
  }
}

async function assertStoreWritable() {
  if (secretStoreLocked()) throw new Error(`API keys are locked to the server environment (${SECRETS_SOURCE_ENV}=environment).`);
  if (await rekeyInProgress()) throw new Error("A master key rotation is in progress. Try again in a few minutes.");
}

/* ---------- identity changes and their consequences ---------- */

/** Pure decision: a change that is real or unknown, with something to lose, needs an explicit confirmation. */
export function confirmationRequired(change: IdentityChange, confirmed: boolean) {
  return change.changed !== false && change.collateral > 0 && !confirmed;
}

/** null = the current value is unknown (store unreadable); an absent current value is not a change. */
export function identityChanged(current: string | null | undefined, candidate: string): boolean | null {
  if (current === null) return null;
  if (!current) return false;
  return current !== candidate;
}

async function currentIdentity(name: SecretName): Promise<string | null> {
  try {
    const { values } = await resolveSecret(name);
    return values?.[SECRET_DEFINITIONS[name].identityField] ?? "";
  } catch {
    return null;
  }
}

/**
 * DataForSEO task IDs belong to the account that posted them. Report whether a candidate login
 * differs from the one in use and how many paid tasks are still waiting to be collected under it.
 */
export async function dataForSeoAccountChange(newLogin: string, currentLogin?: string | null): Promise<IdentityChange> {
  const current = currentLogin === undefined ? await currentIdentity("dataforseo") : currentLogin;
  const changed = identityChanged(current, newLogin);
  if (changed === false) return NO_IDENTITY_CHANGE;
  const [submittedTasks, metricsProjects] = await Promise.all([
    prisma.rankTask.count({ where: { status: { in: ["submitting", "submitted"] } } }),
    prisma.project.count({ where: { keywordMetricsStatus: { in: ["submitting", "submitted"] } } })
  ]);
  return { changed, collateral: submittedTasks + metricsProjects };
}

/**
 * Google refresh tokens are bound to the OAuth client that issued them. Report whether a candidate
 * client ID differs from the one in use and how many connected accounts would have to reconnect.
 */
export async function googleClientChange(newClientId: string, currentClientId?: string | null): Promise<IdentityChange> {
  const current = currentClientId === undefined ? await currentIdentity("google-integrations") : currentClientId;
  const changed = identityChanged(current, newClientId);
  if (changed === false) return NO_IDENTITY_CHANGE;
  return { changed, collateral: await prisma.googleConnection.count() };
}

/** After the client ID changes every stored refresh token is dead; say so on each connection. */
export async function markGoogleConnectionsForReconnect() {
  const updated = await prisma.googleConnection.updateMany({
    data: { lastError: "The Google OAuth client changed. Reconnect this account from Settings." }
  });
  return updated.count;
}

/** The decrypted current and previous versions, for deciding what a rollback or removal would switch to. */
export async function storedSecretVersions(name: SecretName): Promise<{ current: SecretValues | null; previous: SecretValues | null; hasPrevious: boolean }> {
  const definition = SECRET_DEFINITIONS[name];
  const row = await prisma.appSecret.findUnique({ where: { name } });
  if (!row) return { current: null, previous: null, hasPrevious: false };
  return {
    current: readStoredValues(definition, row.encryptedValue),
    previous: row.previousEncryptedValue ? readStoredValues(definition, row.previousEncryptedValue) : null,
    hasPrevious: Boolean(row.previousEncryptedValue)
  };
}

/* ---------- writes ---------- */

export function validateSecretValues(name: SecretName, input: Record<string, unknown>): SecretValues {
  const definition = SECRET_DEFINITIONS[name];
  const values: SecretValues = {};
  for (const field of definition.fields) {
    const raw = input[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) throw new Error(`Enter the ${field.label}.`);
    if (value.length > 512) throw new Error(`The ${field.label} is too long.`);
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`The ${field.label} contains invalid characters.`);
    values[field.key] = value;
  }
  return values;
}

export async function saveSecret(
  name: SecretName,
  values: SecretValues,
  actorEmail: string,
  outcome: { verifiedAt: Date | null; lastError: string | null }
) {
  await assertStoreWritable();
  const definition = SECRET_DEFINITIONS[name];
  const canonical = canonicalValues(definition, values);
  const fingerprint = fingerprintSecret(name, canonical);
  const displayHint = definition.hint(values);
  const encryptedValue = encryptSecret(canonical);
  const now = new Date();

  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.appSecret.findUnique({ where: { name } });
    // Equality is decided on the decrypted value, which stays correct while a previous master key is in play.
    const currentValues = current ? readStoredValues(definition, current.encryptedValue) : null;
    if (currentValues && canonicalValues(definition, currentValues) === canonical) {
      throw new Error(`These ${definition.label} credentials are already stored.`);
    }
    const data: Prisma.AppSecretUncheckedCreateInput = {
      name,
      encryptedValue,
      fingerprint,
      displayHint,
      savedAt: now,
      updatedByEmail: actorEmail,
      lastVerifiedAt: outcome.verifiedAt,
      lastError: outcome.lastError
    };
    if (!current) return tx.appSecret.create({ data });
    return tx.appSecret.update({
      where: { name },
      data: {
        ...data,
        version: current.version + 1,
        previousEncryptedValue: current.encryptedValue,
        previousFingerprint: current.fingerprint,
        previousDisplayHint: current.displayHint,
        previousUpdatedAt: current.updatedAt,
        previousSavedAt: current.savedAt
      }
    });
  });
  invalidateSecretCache(name);
  return summarise(definition, saved, false);
}

export async function rollbackSecret(name: SecretName, actorEmail: string) {
  await assertStoreWritable();
  const definition = SECRET_DEFINITIONS[name];
  const now = new Date();
  const restored = await prisma.$transaction(async (tx) => {
    const current = await tx.appSecret.findUnique({ where: { name } });
    if (!current) throw new Error(`No ${definition.label} credentials are stored in the app.`);
    if (!current.previousEncryptedValue || !current.previousFingerprint || !current.previousDisplayHint) {
      throw new Error(`There is no previous ${definition.label} version to roll back to.`);
    }
    return tx.appSecret.update({
      where: { name },
      data: {
        encryptedValue: current.previousEncryptedValue,
        fingerprint: current.previousFingerprint,
        displayHint: current.previousDisplayHint,
        savedAt: now,
        previousEncryptedValue: current.encryptedValue,
        previousFingerprint: current.fingerprint,
        previousDisplayHint: current.displayHint,
        previousUpdatedAt: current.updatedAt,
        previousSavedAt: current.savedAt,
        version: current.version + 1,
        updatedByEmail: actorEmail,
        lastVerifiedAt: null,
        lastError: null
      }
    });
  });
  invalidateSecretCache(name);
  return summarise(definition, restored, false);
}

export async function removeSecret(name: SecretName) {
  await assertStoreWritable();
  const removed = await prisma.appSecret.deleteMany({ where: { name } });
  invalidateSecretCache(name);
  return removed.count > 0;
}

/** Record a check outcome on the stored row. Never touches a store that is switched off. */
export async function recordVerification(name: SecretName, result: VerificationResult, now = new Date()) {
  if (secretStoreLocked()) return;
  await prisma.appSecret.updateMany({
    where: { name },
    data: result.ok ? { lastVerifiedAt: now, lastError: null } : { lastError: result.message }
  });
  invalidateSecretCache(name);
}

export async function verifySecretValues(name: SecretName, values: SecretValues): Promise<VerificationResult> {
  if (name === "dataforseo") return verifyDataForSeoCredentials(values.login, values.password);
  return verifyGoogleClientCredentials(values.clientId, values.clientSecret);
}

/* ---------- DataForSEO: the free account endpoint proves the login/password pair. ---------- */

const DATAFORSEO_USER_DATA_ENDPOINT = "/v3/appendix/user_data";
/** Credential checks run inside a form submission, so they must answer well within proxy timeouts. */
const PROBE_TIMEOUT_MS = 15_000;

type DataForSeoUserDataBody = {
  status_code?: unknown;
  status_message?: unknown;
  tasks?: Array<{ status_code?: unknown; status_message?: unknown }>;
};

/**
 * Only the envelope status codes are inspected. The response also carries the account email and
 * balance; neither is kept anywhere, so the check leaves no plaintext trace of the credential. A
 * success needs the task entry to succeed too: a bare root 20000 proves nothing was checked.
 */
export function interpretDataForSeoUserData(statusCode: number, body: unknown): VerificationResult {
  const payload = (body && typeof body === "object" ? body : {}) as DataForSeoUserDataBody;
  const task = payload.tasks?.[0];
  const rootCode = typeof payload.status_code === "number" ? payload.status_code : null;
  const taskCode = typeof task?.status_code === "number" ? task.status_code : null;
  const message = [task?.status_message, payload.status_message].find((value): value is string => typeof value === "string" && value.length > 0);

  if (statusCode === 401 || (rootCode !== null && rootCode >= 40100 && rootCode < 40200) || (taskCode !== null && taskCode >= 40100 && taskCode < 40200)) {
    return { ok: false, indeterminate: false, message: "DataForSEO rejected this login and password." };
  }
  if (statusCode >= 200 && statusCode < 300 && rootCode === 20000 && taskCode === 20000) {
    return { ok: true, indeterminate: false, message: "DataForSEO accepted the credentials." };
  }
  return {
    ok: false,
    indeterminate: true,
    message: message ? `DataForSEO answered: ${message}` : `DataForSEO returned HTTP ${statusCode}.`
  };
}

export async function verifyDataForSeoCredentials(login: string, password: string, fetchImpl?: typeof fetch): Promise<VerificationResult> {
  try {
    const response = await fetchWithTimeout(`https://api.dataforseo.com${DATAFORSEO_USER_DATA_ENDPOINT}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      cache: "no-store",
      timeoutMs: PROBE_TIMEOUT_MS,
      retries: 1,
      ...(fetchImpl ? { fetchImpl } : {})
    });
    return interpretDataForSeoUserData(response.status, await readJsonResponse(response));
  } catch (error) {
    return { ok: false, indeterminate: true, message: error instanceof Error ? error.message : "DataForSEO could not be reached." };
  }
}

/* ---------- Google: a deliberately bad refresh token separates a bad client from a bad grant. ---------- */

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Sent as the refresh token; Google answers `invalid_grant` for it only after the client has authenticated. */
export const GOOGLE_PROBE_REFRESH_TOKEN = "star-reports-credential-check";

export function interpretGoogleTokenProbe(statusCode: number, body: unknown): VerificationResult {
  const payload = (body && typeof body === "object" ? body : {}) as { error?: unknown; error_description?: unknown };
  const error = typeof payload.error === "string" ? payload.error : null;
  const description = typeof payload.error_description === "string" ? payload.error_description : null;
  if (error === "invalid_grant") return { ok: true, indeterminate: false, message: "Google accepted the client ID and secret." };
  if (error === "invalid_client" || error === "unauthorized_client") {
    return { ok: false, indeterminate: false, message: "Google did not accept this client ID and secret." };
  }
  // Google authenticates the client before the grant, so any other definitive 4xx (deleted_client,
  // invalid_request, ...) means these credentials cannot be used and must not replace working ones.
  // Throttling answers say nothing about the client and stay indeterminate.
  if (error && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
    return { ok: false, indeterminate: false, message: `Google rejected this client: ${error}${description ? ` (${description})` : ""}.` };
  }
  return {
    ok: false,
    indeterminate: true,
    message: error ? `Google answered: ${error}${description ? ` (${description})` : ""}` : `Google returned HTTP ${statusCode}.`
  };
}

export async function verifyGoogleClientCredentials(clientId: string, clientSecret: string, fetchImpl?: typeof fetch): Promise<VerificationResult> {
  try {
    const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: GOOGLE_PROBE_REFRESH_TOKEN
      }),
      cache: "no-store",
      timeoutMs: PROBE_TIMEOUT_MS,
      retries: 1,
      ...(fetchImpl ? { fetchImpl } : {})
    });
    return interpretGoogleTokenProbe(response.status, await readJsonResponse(response));
  } catch (error) {
    return { ok: false, indeterminate: true, message: error instanceof Error ? error.message : "Google could not be reached." };
  }
}

/* ---------- helpers ---------- */

/** Reveal at most two characters, and only from a well-formed email's local part. */
export function maskIdentifier(value: string | undefined) {
  if (!value) return "";
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(value);
  if (!match) return "***";
  const [, local, domain] = match;
  return local.length >= 5 ? `${local.slice(0, 2)}***@${domain}` : `***@${domain}`;
}

function unreadableMessage(definition: SecretDefinition) {
  return `The stored ${definition.label} credentials are unreadable. Check ${MASTER_KEY_ENV} or save them again.`;
}

function canonicalValues(definition: SecretDefinition, values: SecretValues) {
  return JSON.stringify(definition.fields.map((field) => [field.key, values[field.key] ?? ""]));
}

function parseStoredValues(definition: SecretDefinition, stored: string): SecretValues | null {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return null;
    const values: SecretValues = {};
    for (const entry of parsed) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "string") return null;
      values[entry[0]] = entry[1];
    }
    return definition.fields.every((field) => values[field.key]) ? values : null;
  } catch {
    return null;
  }
}

/** Decrypt and parse a stored value; null when the key is wrong, the row is corrupt, or the shape is off. */
function readStoredValues(definition: SecretDefinition, encryptedValue: string, masterKey?: string): SecretValues | null {
  try {
    return parseStoredValues(definition, decryptSecret(encryptedValue, masterKey));
  } catch {
    return null;
  }
}

function environmentValues(definition: SecretDefinition, env: Record<string, string | undefined>): SecretValues | null {
  const values: SecretValues = {};
  for (const field of definition.fields) {
    const value = env[field.envName]?.trim();
    if (!value) return null;
    values[field.key] = value;
  }
  return values;
}

function summarise(definition: SecretDefinition, row: AppSecret | null, environmentConfigured: boolean): SecretSummary {
  return {
    name: definition.name,
    label: definition.label,
    configured: Boolean(row) || environmentConfigured,
    source: row ? "app" : environmentConfigured ? "environment" : "missing",
    displayHint: row?.displayHint ?? null,
    fingerprint: row?.fingerprint ?? null,
    version: row?.version ?? null,
    updatedByEmail: row?.updatedByEmail ?? null,
    savedAt: row?.savedAt ?? null,
    lastVerifiedAt: row?.lastVerifiedAt ?? null,
    lastError: row?.lastError ?? null,
    hasPrevious: Boolean(row?.previousEncryptedValue),
    previousDisplayHint: row?.previousDisplayHint ?? null,
    previousSavedAt: row?.previousSavedAt ?? null,
    locked: false,
    unavailable: false,
    overridesEnvironment: false,
    environmentConfigured
  };
}
