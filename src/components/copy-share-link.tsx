"use client";

import { useState } from "react";

export function CopyShareLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="share-link-field">
      <input aria-label="Read-only report link" readOnly value={path} />
      <button className="button" type="button" onClick={copyLink}>{copied ? "Copied" : "Copy Link"}</button>
    </div>
  );
}
