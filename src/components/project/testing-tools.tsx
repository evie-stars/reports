import { Icon } from "@/components/icon";
import { LiveRunForm } from "@/components/live-run-form";
import { SandboxRunForm } from "@/components/sandbox-run-form";

type Choice = { id: string; label: string };

export function TestingTools({
  projectId,
  keywords,
  locations,
  credentialsConfigured,
  liveEnabled
}: {
  projectId: string;
  keywords: Choice[];
  locations: Choice[];
  credentialsConfigured: boolean;
  liveEnabled: boolean;
}) {
  return (
    <details className="card group" id="testing">
      <summary className="cursor-pointer flex items-center justify-between gap-3 list-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="font-display font-semibold tracking-tight text-base flex items-center gap-2">
            <Icon name="cog" className="w-4 h-4 text-slate shrink-0" />
            <span className="truncate">Testing tools</span>
          </span>
          <span className="block text-xs text-slate mt-0.5">Run controlled sandbox and single-keyword verification checks</span>
        </span>
        <span className="btn-ghost shrink-0" aria-hidden="true">
          <span className="group-open:hidden">Show tools</span>
          <span className="hidden group-open:inline">Hide tools</span>
        </span>
      </summary>
      <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SandboxRunForm
          projectId={projectId}
          keywords={keywords}
          locations={locations}
          credentialsConfigured={credentialsConfigured}
        />
        <LiveRunForm
          projectId={projectId}
          keywords={keywords}
          locations={locations}
          credentialsConfigured={credentialsConfigured}
          liveEnabled={liveEnabled}
        />
      </div>
    </details>
  );
}
