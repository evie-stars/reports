"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

/** Copies an app-relative path as an absolute URL. `variant="field"` also shows the path in a read-only input. */
export function CopyLink({
  path,
  label = "Copy link",
  copiedLabel = "Copied",
  variant = "button",
  className = ""
}: {
  path: string;
  label?: string;
  copiedLabel?: string;
  variant?: "button" | "field";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (variant === "field") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <input aria-label="Read-only report link" readOnly value={path} className="field font-mono text-xs" />
        <button type="button" onClick={copy} className="btn-primary shrink-0">
          <Icon name={copied ? "tick" : "save"} className="w-3.5 h-3.5" />
          {copied ? copiedLabel : label}
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={copy} className={`btn-ghost ${className}`}>
      <Icon name={copied ? "tick" : "save"} className="w-3.5 h-3.5" />
      {copied ? copiedLabel : label}
    </button>
  );
}
