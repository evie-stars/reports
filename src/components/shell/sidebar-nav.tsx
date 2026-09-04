"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { isNavItemActive, type NavGroup } from "@/components/shell/nav-items";

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5" aria-label="Primary">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 mb-1.5 text-[10px] uppercase tracking-wider font-medium text-white/35">{group.label}</p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = isNavItemActive(item.href, pathname);
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`nav-link ${active ? "nav-link-active" : ""}`}>
                  {active ? <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-accent" /> : null}
                  <Icon name={item.icon} className={`w-4 h-4 shrink-0 transition-colors ${active ? "text-accent" : "opacity-70"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
