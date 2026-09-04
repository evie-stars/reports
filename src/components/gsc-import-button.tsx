"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "@/components/icon";

export function GscImportButton({ hasData }: { hasData: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      <Icon name="arrow-download" className="w-3.5 h-3.5" />
      {pending ? "Importing 90 days…" : hasData ? "Refresh 90 days" : "Import 90 days"}
    </button>
  );
}
