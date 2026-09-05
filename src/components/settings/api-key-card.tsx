import { removeSecret, rollbackSecret, saveSecret, verifyStoredSecret } from "@/actions/secrets";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui/notice";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { SECRET_DEFINITIONS, SECRETS_SOURCE_ENV, type SecretSummary } from "@/lib/app-secrets";
import { formatDateTime, type Tone } from "@/lib/format";

/**
 * Write-only management of one API credential. The card shows where the value comes from, a
 * fingerprint and a masked hint, and lets an environment administrator rotate, test, roll back or
 * remove it. No stored value is ever rendered.
 */
export function ApiKeyCard({
  summary,
  canManage,
  disabledReason
}: {
  summary: SecretSummary;
  canManage: boolean;
  /** When set, the store cannot be used at all (for example the master key is missing) and no forms are shown. */
  disabledReason?: string;
}) {
  const definition = SECRET_DEFINITIONS[summary.name];
  const save = saveSecret.bind(null, summary.name);
  const verify = verifyStoredSecret.bind(null, summary.name);
  const rollback = rollbackSecret.bind(null, summary.name);
  const remove = removeSecret.bind(null, summary.name);
  const status = summaryStatus(summary);
  const envNames = definition.fields.map((field) => field.envName).join(" and ");
  const isGoogle = summary.name === "google-integrations";
  const isDataForSeo = summary.name === "dataforseo";
  const removeConsequence = summary.overridesEnvironment
    ? "The server environment holds different credentials, which will be used instead."
    : summary.environmentConfigured
      ? "The same credentials in the server environment will be used instead."
      : definition.removeConsequence ?? "No server environment value is set, so requests to this provider will fail until a key is added.";
  const rollbackWarning = definition.rollbackWarning ? ` ${definition.rollbackWarning}` : "";
  const blocked = summary.locked || summary.unavailable || Boolean(disabledReason);

  return (
    <SectionCard
      id={`api-key-${summary.name}`}
      title={definition.label}
      subtitle={definition.description}
      icon="lock"
      aside={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
    >
      {summary.locked ? (
        <Notice tone="warn" title="Locked to the server environment.">
          {SECRETS_SOURCE_ENV}=environment is set, so stored keys are ignored and cannot be changed here.
        </Notice>
      ) : summary.unavailable ? (
        <Notice tone="danger" title="The API key store could not be read.">{summary.lastError}</Notice>
      ) : disabledReason ? (
        <Notice tone="warn" title="API keys cannot be managed yet.">{disabledReason}</Notice>
      ) : null}

      <div className="rounded-xl border border-line bg-paper/60 p-3 mb-4 text-sm">
        {summary.source === "app" ? (
          <>
            <p className="font-medium truncate">
              {summary.displayHint}
              <span className="font-mono text-xs text-slate ml-2">#{summary.fingerprint}</span>
              <span className="text-xs text-slate ml-2">v{summary.version}</span>
            </p>
            <p className="text-xs text-slate mt-1">
              Saved by {summary.updatedByEmail} on {formatDateTime(summary.savedAt)}
              {summary.lastVerifiedAt ? ` · checked ${formatDateTime(summary.lastVerifiedAt)}` : " · not checked yet"}
              {summary.hasPrevious ? ` · previous version ${summary.previousDisplayHint} saved ${formatDateTime(summary.previousSavedAt)}` : ""}
            </p>
            {summary.overridesEnvironment ? (
              <p className="text-xs text-warn mt-1">Overrides a different value set in the server environment.</p>
            ) : null}
            {summary.lastError ? <p className="text-xs text-blocked mt-1">{summary.lastError}</p> : null}
          </>
        ) : summary.source === "environment" ? (
          <>
            <p className="font-medium">Using the server environment</p>
            <p className="text-xs text-slate mt-1">
              Read from {envNames} on the server.
              {summary.locked ? "" : " Saving credentials here takes precedence and applies without a restart."}
            </p>
          </>
        ) : summary.unavailable ? (
          <p className="font-medium">Store unavailable</p>
        ) : (
          <>
            <p className="font-medium">No credentials configured</p>
            <p className="text-xs text-slate mt-1">
              {summary.locked ? `Set ${envNames} on the server.` : `Save them here, or set ${envNames} on the server.`}
            </p>
          </>
        )}
      </div>

      {blocked ? null : canManage ? (
        <>
          {summary.configured || summary.source === "app" ? (
            <div className="flex flex-wrap gap-2 mb-4">
              {summary.configured ? (
                <form action={verify}>
                  <SubmitButton className="btn-ghost" pendingLabel="Checking…"><Icon name="tick-circle" className="w-3.5 h-3.5" />Check current</SubmitButton>
                </form>
              ) : null}
              {summary.hasPrevious ? (
                <form action={rollback}>
                  <SubmitButton
                    className="btn-ghost"
                    confirmMessage={`Restore the previous ${definition.label} credentials (${summary.previousDisplayHint})? The current ones are kept as the new previous version.${rollbackWarning}`}
                    pendingLabel="Restoring…"
                  >
                    <Icon name="reload" className="w-3.5 h-3.5" />Roll back
                  </SubmitButton>
                </form>
              ) : null}
              {summary.source === "app" ? (
                <form action={remove}>
                  <SubmitButton
                    className="btn-danger"
                    confirmMessage={`Remove the ${definition.label} credentials stored in the app? ${removeConsequence}`}
                    pendingLabel="Removing…"
                  >
                    Remove from app
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ) : null}

          <form action={save} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {definition.fields.map((field) => (
                <label className="block" key={field.key}>
                  <span className="field-label">{field.label}</span>
                  <input
                    autoComplete="new-password"
                    className="field"
                    inputMode={field.inputMode}
                    name={field.key}
                    placeholder={field.placeholder}
                    required
                    spellCheck={false}
                    type={field.secret ? "password" : "text"}
                  />
                </label>
              ))}
            </div>
            {isGoogle ? (
              <label className="choice items-start">
                <input name="confirmClientChange" type="checkbox" className="mt-0.5" />
                <span className="text-xs text-slate">
                  I understand that a different client ID requires every connected Google account to reconnect. Rotating only the secret under the same client ID keeps them working.
                </span>
              </label>
            ) : null}
            {isDataForSeo ? (
              <label className="choice items-start">
                <input name="confirmAccountChange" type="checkbox" className="mt-0.5" />
                <span className="text-xs text-slate">
                  I understand that switching to a different DataForSEO account loses any paid tasks already submitted under the current one. Rotating the password of the same account is safe.
                </span>
              </label>
            ) : null}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-slate">The new credentials are checked with the provider before they replace the current ones.</p>
              <SubmitButton pendingLabel="Checking and saving…"><Icon name="save" className="w-3.5 h-3.5" />Save and check</SubmitButton>
            </div>
          </form>
        </>
      ) : (
        <p className="text-xs text-slate">Only administrators listed in AUTH_ADMIN_EMAILS can change API keys.</p>
      )}
    </SectionCard>
  );
}

function summaryStatus(summary: SecretSummary): { tone: Tone; label: string } {
  if (summary.locked) return { tone: "warn", label: "Locked to environment" };
  if (summary.unavailable) return { tone: "blocked", label: "Store unavailable" };
  if (summary.source === "app") return summary.configured ? { tone: "accent", label: "Stored in app" } : { tone: "blocked", label: "Unreadable" };
  if (summary.source === "environment") return { tone: "warn", label: "Server environment" };
  return { tone: "blocked", label: "Missing" };
}
