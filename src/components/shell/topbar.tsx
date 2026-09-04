"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Crumb = { label: string; href?: string };

export function Topbar({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 h-12 px-4 md:px-8 border-b border-line bg-paper/85 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="md:hidden flex items-center gap-2 font-display font-semibold shrink-0">
          <span className="inline-block w-2 h-2 rounded-full bg-accent" />
          Report Hub
        </span>
        <nav className="hidden md:flex items-center gap-1.5 text-xs text-slate min-w-0" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5 min-w-0">
              {index > 0 ? <span aria-hidden className="text-line">/</span> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-ink transition-colors truncate">{crumb.label}</Link>
              ) : (
                <span aria-current="page" className="text-ink font-medium truncate">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </header>
  );
}

function breadcrumbsFor(pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Dashboard" }];
  if (pathname === "/clients") return [{ label: "Clients" }];
  if (pathname.startsWith("/clients/")) return [{ label: "Clients", href: "/clients" }, { label: "Client report" }];
  if (pathname.startsWith("/projects/")) return [{ label: "Clients", href: "/clients" }, { label: "Report settings" }];
  if (pathname === "/runs") return [{ label: "Rank Runs" }];
  if (pathname.startsWith("/runs/")) return [{ label: "Rank Runs", href: "/runs" }, { label: "Run details" }];
  if (pathname === "/scheduled") return [{ label: "Scheduled" }];
  if (pathname === "/settings") return [{ label: "Settings" }];
  return [{ label: "Report Hub" }];
}
