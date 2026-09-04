import Image from "next/image";
import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { homeHrefFor, navGroupsFor } from "@/components/shell/nav-items";
import type { CurrentActor } from "@/lib/access";
import { roleLabel } from "@/lib/roles";

export function Sidebar({ actor, authEnabled }: { actor: CurrentActor; authEnabled: boolean }) {
  return (
    <aside className="hidden md:flex w-56 shrink-0 h-screen sticky top-0 flex-col justify-between py-6 px-3">
      <div>
        <Link href={homeHrefFor(actor.role)} className="block px-3 mb-8" aria-label="Report Hub home">
          <Image src="/star-websites.png" alt="Star Websites" width={96} height={38} priority className="h-8 w-auto mb-3" />
          <span className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_10px] shadow-accent/50" />
            <span className="font-display font-semibold text-lg text-white">Report Hub</span>
          </span>
        </Link>
        <SidebarNav groups={navGroupsFor(actor.role)} />
      </div>
      <div className="px-3 space-y-2">
        <p className="text-xs text-white/45 truncate" title={actor.email}>{actor.name ?? actor.email}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/60">{roleLabel(actor.role)}</span>
          {authEnabled ? (
            <form action={signOutAction}>
              <button type="submit" className="text-xs text-white/55 hover:text-white transition-colors">Sign out</button>
            </form>
          ) : (
            <span className="text-[11px] text-warn/90">Sign-in disabled</span>
          )}
        </div>
      </div>
    </aside>
  );
}
