import { Icon } from "@/components/icon";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/access";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await currentActor();
  if (actor.role !== "admin") redirect("/");
  const sandbox = process.env.DATAFORSEO_SANDBOX !== "false";
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const maxLiveTasks = process.env.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN ?? "1";
  const maxStandardTasks = process.env.DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN ?? "1000";
  const keywordMetricsEnabled = process.env.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";
  const credentialsConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const authEnabled = process.env.AUTH_ENABLED === "true";
  const allowedAccessConfigured = Boolean(process.env.AUTH_ALLOWED_EMAILS || process.env.AUTH_ALLOWED_DOMAINS);
  const budget = await getDataForSeoBudgetSummary();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Integration status and safety limits for the first build phase.</p>
        </div>
      </header>

      <section className="grid two">
        <div className="card">
          <p className="label label-with-icon"><Icon name="settings" />DataForSEO</p>
          <table className="table">
            <tbody>
              <tr>
                <th>Credentials</th>
                <td><span className={credentialsConfigured ? "status good" : "status danger"}>{credentialsConfigured ? "Configured" : "Missing"}</span></td>
              </tr>
              <tr>
                <th>Default Mode</th>
                <td>{sandbox ? "Sandbox" : "Live"}</td>
              </tr>
              <tr>
                <th>Live Enabled</th>
                <td><span className={liveEnabled ? "status warn" : "status good"}>{liveEnabled ? "Yes" : "No"}</span></td>
              </tr>
              <tr>
                <th>Max Live Tasks</th>
                <td>{maxLiveTasks}</td>
              </tr>
              <tr>
                <th>Max Standard Tasks</th>
                <td>{maxStandardTasks}</td>
              </tr>
              <tr>
                <th>Keyword Metrics</th>
                <td><span className={keywordMetricsEnabled ? "status warn" : "status good"}>{keywordMetricsEnabled ? "Paid access enabled" : "Disabled"}</span></td>
              </tr>
              <tr>
                <th>Monthly Budget</th>
                <td>${budget.spentUsd.toFixed(4)} spent · ${budget.reservedUsd.toFixed(4)} reserved · ${budget.limitUsd.toFixed(2)} limit</td>
              </tr>
              <tr>
                <th>Queue Delay</th>
                <td>{process.env.RANK_QUEUE_DELAY_MS ?? "750"} ms</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <p className="label label-with-icon"><Icon name="contacts" />Access</p>
          <table className="table">
            <tbody>
              <tr>
                <th>Google Sign-in</th>
                <td><span className={authEnabled ? "status good" : "status warn"}>{authEnabled ? "Enabled" : "Setup required"}</span></td>
              </tr>
              <tr>
                <th>Access Allowlist</th>
                <td><span className={allowedAccessConfigured ? "status good" : "status danger"}>{allowedAccessConfigured ? "Configured" : "Missing"}</span></td>
              </tr>
              <tr>
                <th>Sales Cooldown</th>
                <td>{process.env.RANK_SALES_COOLDOWN_DAYS ?? "7"} days</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <p className="label label-with-icon"><Icon name="graph" />Next Integrations</p>
          <h3>GA4 and GSC placeholders</h3>
          <p className="muted">
            The database includes snapshot tables for Google Analytics and Google Search Console. We can add OAuth/import jobs after rank tracking is stable.
          </p>
        </div>
      </section>
    </>
  );
}
