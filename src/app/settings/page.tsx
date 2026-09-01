export default function SettingsPage() {
  const sandbox = process.env.DATAFORSEO_SANDBOX !== "false";
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const maxLiveTasks = process.env.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN ?? "1";

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
          <p className="label">DataForSEO</p>
          <table className="table">
            <tbody>
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
            </tbody>
          </table>
        </div>

        <div className="card">
          <p className="label">Next Integrations</p>
          <h3>GA4 and GSC placeholders</h3>
          <p className="muted">
            The database includes snapshot tables for Google Analytics and Google Search Console. We can add OAuth/import jobs after rank tracking is stable.
          </p>
        </div>
      </section>
    </>
  );
}
