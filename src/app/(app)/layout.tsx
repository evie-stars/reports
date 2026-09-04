import { signOutAction } from "@/actions/auth";
import { MobileNav } from "@/components/shell/mobile-nav";
import { navGroupsFor } from "@/components/shell/nav-items";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticationEnabled, currentActor } from "@/lib/access";
import { roleLabel } from "@/lib/roles";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  const authEnabled = authenticationEnabled();
  const groups = navGroupsFor(actor.role);

  return (
    <div className="flex min-h-screen md:h-screen">
      <Sidebar actor={actor} authEnabled={authEnabled} />
      <div className="flex-1 min-w-0 flex flex-col bg-paper md:m-3 md:rounded-2xl md:overflow-hidden md:shadow-lift md:ring-1 md:ring-white/10">
        <Topbar>
          <StatusPill tone="accent" className="hidden sm:inline-flex">API guardrails active</StatusPill>
          <StatusPill tone="default" dot={false}>{roleLabel(actor.role)}</StatusPill>
        </Topbar>
        <main className="flex-1 min-h-0 md:overflow-y-auto p-4 pb-24 md:p-8">{children}</main>
        <MobileNav groups={groups} email={actor.email} signOutAction={authEnabled ? signOutAction : null} />
      </div>
    </div>
  );
}
