import Link from "next/link";
import { Icon } from "@/components/icon";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen md:h-screen">
      <div className="flex-1 min-w-0 flex flex-col bg-paper md:m-3 md:rounded-2xl md:overflow-hidden md:shadow-lift md:ring-1 md:ring-white/10 items-center justify-center p-6">
        <div className="card w-full max-w-md text-center p-8">
          <span className="mx-auto mb-4 grid place-items-center w-12 h-12 rounded-xl bg-line/60 text-slate">
            <Icon name="help-circle" className="w-6 h-6" />
          </span>
          <p className="eyebrow mb-1">Not found</p>
          <h1 className="text-xl mb-2">That record is not available</h1>
          <p className="text-sm text-slate mb-6">It may have been removed, or the link may no longer be valid.</p>
          <Link href="/" className="btn-primary">Return to Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
