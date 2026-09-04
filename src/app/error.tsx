"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="state-panel" role="alert">
      <span className="state-mark danger" aria-hidden="true">!</span>
      <p className="label">Page unavailable</p>
      <h2>This page could not load</h2>
      <p>The reporting data is safe. Try loading this view again.</p>
      <button className="button" onClick={retry} type="button">Try Again</button>
      {error.digest ? <small>Reference {error.digest}</small> : null}
    </section>
  );
}
