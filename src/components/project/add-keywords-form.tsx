import { createKeywords } from "@/actions/projects";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/ui/section-card";

export function AddKeywordsForm({ projectId }: { projectId: string }) {
  return (
    <SectionCard title="Add keywords" subtitle="One keyword per line; duplicates are skipped" icon="add-circle">
      <form action={createKeywords} className="flex flex-col gap-3 h-full">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="block">
          <span className="field-label">Keywords</span>
          <textarea
            name="phrases"
            required
            rows={7}
            placeholder={"emergency plumber manchester\nboiler repair manchester\nlocal plumber near me"}
            className="field"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Group for all keywords</span>
            <input name="group" placeholder="Emergency" className="field" />
          </label>
          <label className="block">
            <span className="field-label">Target URL for all keywords</span>
            <input name="targetUrl" placeholder="https://example.co.uk/service" className="field" />
          </label>
        </div>
        <div className="flex justify-end mt-auto pt-1">
          <SubmitButton pendingLabel="Adding keywords…"><Icon name="add" className="w-3.5 h-3.5" />Add keywords</SubmitButton>
        </div>
      </form>
    </SectionCard>
  );
}
