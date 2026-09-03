"use client";

import { useFormStatus } from "react-dom";

export function GscImportButton({ hasData }: { hasData: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? "Importing 90 days..." : hasData ? "Refresh 90 Days" : "Import 90 Days"}
    </button>
  );
}
