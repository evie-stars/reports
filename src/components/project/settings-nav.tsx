const LINK_CLASS = "px-4 py-2 text-sm -mb-px border-b-2 border-transparent text-slate whitespace-nowrap transition-colors hover:text-ink hover:border-line";

/** Horizontal anchor navigation for the sections of the report settings page. */
export function SettingsNav({ showTesting }: { showTesting: boolean }) {
  return (
    <nav className="flex gap-1 border-b border-line mb-6 overflow-x-auto" aria-label="Report settings sections">
      <a href="#general" className={LINK_CLASS}>General</a>
      <a href="#report-content" className={LINK_CLASS}>Report content</a>
      <a href="#search-console" className={LINK_CLASS}>Search Console</a>
      <a href="#schedule" className={LINK_CLASS}>Schedule</a>
      <a href="#tracking-lists" className={LINK_CLASS}>Keywords &amp; areas</a>
      {showTesting ? <a href="#testing" className={LINK_CLASS}>Testing</a> : null}
      <a href="#activity" className={LINK_CLASS}>Activity</a>
    </nav>
  );
}
