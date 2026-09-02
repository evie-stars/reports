"use client";

import { useState } from "react";

export function CopyShareButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return <button className="button button-secondary" type="button" onClick={copyLink}>{copied ? "Link Copied" : "Client Link"}</button>;
}
