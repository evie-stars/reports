import { updateProject } from "@/actions/projects";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";

export function ProjectDetailsForm({
  project,
  activeKeywordCount,
  activeLocationCount,
  recentRunCount
}: {
  project: {
    id: string;
    clientId: string;
    name: string;
    domain: string;
    targetBusinessName: string | null;
    serviceArea: string | null;
  };
  activeKeywordCount: number;
  activeLocationCount: number;
  recentRunCount: number;
}) {
  const updateProjectWithId = updateProject.bind(null, project.id);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" id="general">
      <SectionCard title="Project details" subtitle="Name, domain and the business to look for in results" icon="home">
        <form action={updateProjectWithId} className="space-y-3">
          <input type="hidden" name="clientId" value={project.clientId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="field-label">Project name</span>
              <input name="name" required defaultValue={project.name} className="field" />
            </label>
            <label className="block">
              <span className="field-label">Domain</span>
              <input name="domain" required defaultValue={project.domain} className="field" />
            </label>
            <label className="block">
              <span className="field-label">Target business name</span>
              <input name="targetBusinessName" defaultValue={project.targetBusinessName ?? ""} className="field" />
            </label>
            <label className="block">
              <span className="field-label">Service area</span>
              <input name="serviceArea" defaultValue={project.serviceArea ?? ""} className="field" />
            </label>
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving project…"><Icon name="save" className="w-3.5 h-3.5" />Save project</SubmitButton>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Tracking summary" subtitle="What the monthly report currently covers" icon="bookmark">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <StatCard label="Active keywords" value={activeKeywordCount} icon="bookmark" tone="accent" />
          <StatCard label="Active areas" value={activeLocationCount} icon="map-pin" tone="sky" />
          <StatCard label="Recent runs" value={recentRunCount} icon="refresh" />
        </div>
      </SectionCard>
    </div>
  );
}
