import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeHtml,
  isEmailAddress,
  notificationSettings,
  outcomesNeedingAttention,
  publicAppUrl,
  reportRequestMessage,
  resolveRecipients,
  scheduledReportDigestMessage,
  testMessage,
  type ScheduledReportOutcome
} from "../src/lib/notifications";
import { moduleOutcomes } from "../src/lib/scheduled-report-worker";
import { interpretSmtpError, smtpSettingsFromValues, smtpTransportOptions, validateSmtpPort } from "../src/lib/smtp";

const outcome = (overrides: Partial<ScheduledReportOutcome> = {}): ScheduledReportOutcome => ({
  executionId: "exec-1",
  projectId: "project-1",
  clientId: "client-1",
  rankRunId: "run-1",
  status: "failed",
  clientName: "Acme",
  projectName: "Main site",
  scheduledFor: new Date("2026-09-01T00:00:00.000Z"),
  modules: [{ label: "SEO", status: "failed", error: "Budget exceeded." }],
  ...overrides
});

test("notifications stay off until explicitly enabled and a From address is set", () => {
  assert.deepEqual(notificationSettings({}), { enabled: false, from: null, recipientsOverride: [] });
  assert.deepEqual(
    notificationSettings({ NOTIFICATIONS_ENABLED: "true", NOTIFICATIONS_FROM: " Star Reports <reports@example.test> ", NOTIFICATION_EMAILS: "A@example.test, b@example.test" }),
    { enabled: true, from: "Star Reports <reports@example.test>", recipientsOverride: ["a@example.test", "b@example.test"] }
  );
  assert.equal(notificationSettings({ NOTIFICATIONS_ENABLED: "yes" }).enabled, false);
});

test("the recipient override wins, otherwise administrators, always deduplicated and validated", () => {
  assert.deepEqual(resolveRecipients(["Ops@example.test", "ops@example.test"], ["owner@example.test"]), ["ops@example.test"]);
  assert.deepEqual(resolveRecipients([], ["Owner@example.test", "owner@example.test", "not-an-email", ""]), ["owner@example.test"]);
  assert.deepEqual(resolveRecipients([], []), []);
  assert.equal(isEmailAddress("local-admin"), false);
  assert.equal(isEmailAddress("evie@starwebsites.co.uk"), true);
});

test("app links are built from the public URL and omitted when none is configured", () => {
  assert.equal(publicAppUrl("/scheduled", { AUTH_URL: "https://reports.example.test" }), "https://reports.example.test/scheduled");
  assert.equal(publicAppUrl("/", { GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: "https://reports.example.test/api/integrations/google/callback" }), "https://reports.example.test/");
  assert.equal(publicAppUrl("/", {}), null);
  assert.equal(publicAppUrl("/", { AUTH_URL: "not a url" }), null);
});

test("a report request email names the requester and client, escapes HTML, and links only when possible", () => {
  const message = reportRequestMessage({
    clientName: "Acme <Roofing>",
    websiteUrl: "https://acme.example",
    notes: "Needs SEO & Maps\nby Friday",
    requestedByEmail: "sam@example.test",
    requestedByName: "Sam",
    appUrl: "https://reports.example.test/"
  });
  assert.equal(message.subject, "New report request: Acme <Roofing>");
  assert.match(message.text, /Sam \(sam@example\.test\) has requested a report for Acme <Roofing>/);
  assert.match(message.text, /Website: https:\/\/acme\.example/);
  assert.match(message.text, /Review it on the dashboard: https:\/\/reports\.example\.test\//);
  assert.match(message.html, /Acme &lt;Roofing&gt;/);
  assert.match(message.html, /SEO &amp; Maps<br>by Friday/);
  assert.doesNotMatch(message.html, /<Roofing>/);

  const unlinked = reportRequestMessage({ clientName: "Acme", websiteUrl: null, notes: null, requestedByEmail: "sam@example.test", requestedByName: null, appUrl: null });
  assert.doesNotMatch(unlinked.text, /Review it/);
  assert.doesNotMatch(unlinked.text, /Website:/);
  assert.doesNotMatch(unlinked.text, /Notes:/);
  assert.match(unlinked.text, /^sam@example\.test has requested/);
});

test("the scheduled digest lists every report needing attention with links to fix it", () => {
  const appUrl = (pathname: string) => `https://reports.example.test${pathname}`;
  const single = scheduledReportDigestMessage([outcome({ status: "partial", modules: [
    { label: "SEO + Maps", status: "completed", error: null },
    { label: "Search Console", status: "failed", error: "Google returned HTTP 403." },
    { label: "Analytics", status: "not_selected", error: null }
  ] })], appUrl);
  assert.equal(single.subject, "Scheduled report finished partially: Acme / Main site");
  assert.match(single.text, /Acme \/ Main site \(scheduled 1 September 2026\) finished partially\./);
  assert.match(single.text, /SEO \+ Maps: completed/);
  assert.match(single.text, /Search Console: failed \(Google returned HTTP 403\.\)/);
  assert.match(single.text, /Analytics: not selected/);
  assert.match(single.text, /Fix the report settings: https:\/\/reports\.example\.test\/projects\/project-1#schedule/);
  assert.match(single.text, /Rank run: https:\/\/reports\.example\.test\/runs\/run-1/);
  assert.match(single.text, /All scheduled reports: https:\/\/reports\.example\.test\/scheduled/);
  assert.match(single.html, /<li>Search Console: failed <em>\(Google returned HTTP 403\.\)<\/em><\/li>/);
  assert.match(single.html, /href="https:\/\/reports\.example\.test\/projects\/project-1#schedule"/);

  const many = scheduledReportDigestMessage([
    outcome({ status: "blocked", rankRunId: null, projectName: "Site <A>" }),
    outcome({ executionId: "exec-2", projectId: "project-2", clientName: "Beta", projectName: "Shop", status: "failed" })
  ], () => null);
  assert.equal(many.subject, "2 scheduled reports need attention");
  assert.match(many.text, /Acme \/ Site <A> .* was blocked/);
  assert.match(many.text, /Beta \/ Shop .* failed/);
  assert.doesNotMatch(many.text, /https?:\/\//);
  assert.match(many.html, /Site &lt;A&gt;/);
  assert.doesNotMatch(many.html, /href=/);
});

test("only failed, partial, and blocked outcomes are digested", () => {
  const filtered = outcomesNeedingAttention([
    outcome({ status: "completed" }),
    outcome({ executionId: "exec-2", status: "failed" }),
    outcome({ executionId: "exec-3", status: "partial" }),
    outcome({ executionId: "exec-4", status: "blocked" }),
    outcome({ executionId: "exec-5", status: "running" })
  ]);
  assert.deepEqual(filtered.map((item) => item.executionId), ["exec-2", "exec-3", "exec-4"]);
  assert.deepEqual(outcomesNeedingAttention([outcome({ status: "completed" })]), []);
});

test("module outcomes follow the Scheduled page's labels and order", () => {
  const states = { rankingsStatus: "completed", rankingsError: null, gscStatus: "failed", gscError: "boom", ga4Status: "blocked", ga4Error: "Map a property." } as const;
  assert.deepEqual(moduleOutcomes(["rankings", "maps", "gsc", "ga4"], states), [
    { label: "SEO + Maps", status: "completed", error: null },
    { label: "Search Console", status: "failed", error: "boom" },
    { label: "Analytics", status: "blocked", error: "Map a property." }
  ]);
  assert.deepEqual(moduleOutcomes(["maps"], states).map((item) => item.label), ["Maps"]);
  assert.deepEqual(moduleOutcomes(["rankings"], states).map((item) => item.label), ["SEO"]);
  assert.deepEqual(moduleOutcomes(["gsc"], states).map((item) => item.label), ["Search Console"]);
});

test("the test email identifies the sender and HTML escaping covers every special character", () => {
  const message = testMessage({ actorEmail: "owner@example.test", appUrl: null });
  assert.equal(message.subject, "Star Reports test email");
  assert.match(message.text, /sent from Star Reports Settings by owner@example\.test/);
  assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
});

test("SMTP transport always uses TLS: implicit on 465, required STARTTLS elsewhere, with every timeout set", () => {
  const settings = smtpSettingsFromValues({ host: "mail.example.test", port: "465", user: "u", password: "p" });
  const implicit = smtpTransportOptions(settings);
  assert.equal(implicit.secure, true);
  assert.equal(implicit.requireTLS, false);
  const startTls = smtpTransportOptions({ ...settings, port: 587 });
  assert.equal(startTls.secure, false);
  assert.equal(startTls.requireTLS, true);
  assert.deepEqual(startTls.auth, { user: "u", pass: "p" });
  for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout", "dnsTimeout"] as const) {
    assert.equal(startTls[key], 15_000, key);
  }
  assert.throws(() => smtpSettingsFromValues({ host: "mail.example.test", port: "x", user: "u", password: "p" }), /incomplete/);
});

test("SMTP settings validate the port and classify errors without copying server text", () => {
  assert.equal(validateSmtpPort("587"), null);
  assert.equal(validateSmtpPort("65535"), null);
  assert.match(validateSmtpPort("0") ?? "", /between 1 and 65535/);
  assert.match(validateSmtpPort("65536") ?? "", /between 1 and 65535/);
  assert.match(validateSmtpPort("25.5") ?? "", /between 1 and 65535/);

  const at = { host: "mail.example.test", port: 587 };
  const badPassword = interpretSmtpError({ code: "EAUTH", responseCode: 535, message: "535 5.7.8 Error: authentication failed: https://support.example/continue?token=abc" }, at);
  assert.deepEqual([badPassword.ok, badPassword.indeterminate], [false, false]);
  assert.match(badPassword.message, /rejected the mailbox username and password/);
  assert.doesNotMatch(badPassword.message, /token=abc/);
  const temporary = interpretSmtpError({ code: "EAUTH", responseCode: 454, message: "454 4.7.0 Temporary authentication failure" }, at);
  assert.deepEqual([temporary.ok, temporary.indeterminate], [false, true]);
  const noAuth = interpretSmtpError({ code: "EAUTH", responseCode: 503, message: "503 AUTH not available" }, at);
  assert.deepEqual([noAuth.ok, noAuth.indeterminate], [false, false]);
  assert.match(noAuth.message, /does not offer authentication/);
  const tls = interpretSmtpError({ code: "ETLS", message: "no STARTTLS" }, at);
  assert.deepEqual([tls.ok, tls.indeterminate], [false, false]);
  const dns = interpretSmtpError({ code: "EDNS", message: "getaddrinfo ENOTFOUND mail.example.test" }, at);
  assert.deepEqual([dns.ok, dns.indeterminate], [false, false]);
  assert.match(dns.message, /No mail server was found at mail\.example\.test/);
  const refused = interpretSmtpError({ code: "ECONNECTION", message: "connect ECONNREFUSED 203.0.113.1:587" }, at);
  assert.deepEqual([refused.ok, refused.indeterminate], [false, false]);
  assert.match(refused.message, /Nothing is listening at mail\.example\.test:587/);
  const certificate = interpretSmtpError({ code: "ESOCKET", message: "Hostname/IP does not match certificate's altnames" }, at);
  assert.deepEqual([certificate.ok, certificate.indeterminate], [false, false]);
  const envelope = interpretSmtpError({ code: "EENVELOPE", responseCode: 553, message: "553 Sender address rejected: not owned by user" }, at);
  assert.deepEqual([envelope.ok, envelope.indeterminate], [false, false]);
  assert.match(envelope.message, /NOTIFICATIONS_FROM/);
  const timeout = interpretSmtpError({ code: "ETIMEDOUT", message: "Connection timeout" }, at);
  assert.deepEqual([timeout.ok, timeout.indeterminate], [false, true]);
  const unknown = interpretSmtpError(null, at);
  assert.deepEqual([unknown.ok, unknown.indeterminate], [false, true]);
});
