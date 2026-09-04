import type { IconName } from "@/components/icon";
import type { AppRole } from "@/lib/roles";

export type NavItem = { href: string; label: string; shortLabel?: string; icon: IconName };
export type NavGroup = { label: string; items: NavItem[] };

const REPORTING: NavItem[] = [
  { href: "/", label: "Dashboard", shortLabel: "Home", icon: "home" },
  { href: "/clients", label: "Clients", icon: "users" },
  { href: "/runs", label: "Rank Runs", shortLabel: "Runs", icon: "refresh" },
  { href: "/scheduled", label: "Scheduled", icon: "calendar" }
];

const ADMIN: NavItem[] = [{ href: "/settings", label: "Settings", icon: "cog" }];

export function navGroupsFor(role: AppRole): NavGroup[] {
  const reporting = role === "admin" ? REPORTING : REPORTING.filter((item) => item.href !== "/");
  return role === "admin"
    ? [{ label: "Reporting", items: reporting }, { label: "Admin", items: ADMIN }]
    : [{ label: "Reporting", items: reporting }];
}

export function isNavItemActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function homeHrefFor(role: AppRole) {
  return role === "admin" ? "/" : "/clients";
}
