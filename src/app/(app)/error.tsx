"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icon";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]" role="alert">
      <div className="card w-full max-w-md text-center p-8">
        <span className="mx-auto mb-4 grid place-items-center w-12 h-12 rounded-xl bg-blocked/10 text-blocked">
          <Icon name="alert-circle" className="w-6 h-6" />
        </span>
        <p className="eyebrow mb-1">Page unavailable</p>
        <h1 className="text-xl mb-2">This page could not load</h1>
        <p className="text-sm text-slate mb-6">The reporting data is safe. Try loading this view again.</p>
        <button className="btn-primary" onClick={retry} type="button">Try again</button>
        {error.digest ? <p className="text-[11px] text-slate mt-4">Reference {error.digest}</p> : null}
      </div>
    </div>
  );
}
