import Link from "next/link";

export default function NotFoundPage() {
  return (
    <section className="state-panel">
      <span className="state-mark" aria-hidden="true">404</span>
      <p className="label">Not found</p>
      <h2>That record is not available</h2>
      <p>It may have been removed, or the link may no longer be valid.</p>
      <Link className="button" href="/">Return to Dashboard</Link>
    </section>
  );
}
