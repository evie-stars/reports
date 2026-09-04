"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";

export function AppShell({
  children,
  accountControl,
  appRole
}: {
  children: React.ReactNode;
  accountControl?: React.ReactNode;
  appRole?: "admin" | "sales";
}) {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);
  const [navigationOpen, setNavigationOpen] = useState(false);

  if (pathname.startsWith("/share/") || pathname === "/login") {
    return <main className="shared-main">{children}</main>;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar${navigationOpen ? " navigation-open" : ""}`}>
        <div className="brand-block">
          <Link className="brand-link" href="/" aria-label="Report Hub dashboard">
            <Image
              className="brand-logo"
              src="/star-websites.png"
              alt="Star Websites"
              width={684}
              height={273}
              priority
            />
            <h1>Report Hub</h1>
          </Link>
          <button
            aria-controls="primary-navigation"
            aria-expanded={navigationOpen}
            aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
            className="navigation-toggle"
            onClick={() => setNavigationOpen((open) => !open)}
            type="button"
          >
            <span /><span /><span />
          </button>
        </div>
        <nav id="primary-navigation" aria-label="Primary navigation">
          <NavigationLink href="/" pathname={pathname} icon="home" onNavigate={() => setNavigationOpen(false)}>Dashboard</NavigationLink>
          <NavigationLink href="/clients" pathname={pathname} icon="contacts" onNavigate={() => setNavigationOpen(false)}>Clients</NavigationLink>
          <NavigationLink href="/runs" pathname={pathname} icon="graph" onNavigate={() => setNavigationOpen(false)}>Rank Runs</NavigationLink>
          {appRole !== "sales" ? <NavigationLink href="/settings" pathname={pathname} icon="settings" onNavigate={() => setNavigationOpen(false)}>Settings</NavigationLink> : null}
        </nav>
      </aside>
      <main>
        <div className="topbar">
          <nav className="topbar-breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((breadcrumb, index) => (
              <span key={`${breadcrumb.label}-${index}`}>
                {index > 0 ? <span className="breadcrumb-separator" aria-hidden="true">/</span> : null}
                {breadcrumb.href ? <Link href={breadcrumb.href}>{breadcrumb.label}</Link> : <span aria-current="page">{breadcrumb.label}</span>}
              </span>
            ))}
          </nav>
          <div className="topbar-actions">
            <span className="status good guardrail-status"><span className="guardrail-long">API guardrails active</span><span className="guardrail-short">Protected</span></span>
            {accountControl}
          </div>
        </div>
        <div className="page-content" key={pathname}>{children}</div>
      </main>
    </div>
  );
}

function getBreadcrumbs(pathname: string) {
  if (pathname === "/") return [{ label: "Dashboard" }];
  if (pathname === "/clients") return [{ label: "Clients" }];
  if (pathname.startsWith("/clients/")) return [{ label: "Clients", href: "/clients" }, { label: "Client report" }];
  if (pathname.startsWith("/projects/")) return [{ label: "Clients", href: "/clients" }, { label: "Edit report" }];
  if (pathname === "/runs") return [{ label: "Rank Runs" }];
  if (pathname.startsWith("/runs/")) return [{ label: "Rank Runs", href: "/runs" }, { label: "Run details" }];
  if (pathname === "/settings") return [{ label: "Settings" }];
  return [{ label: "Report Hub" }];
}

function NavigationLink({
  children,
  href,
  icon,
  onNavigate,
  pathname
}: {
  children: React.ReactNode;
  href: string;
  icon: "home" | "contacts" | "graph" | "settings";
  onNavigate: () => void;
  pathname: string;
}) {
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link className={active ? "active" : undefined} href={href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
      <Icon name={icon} />{children}
    </Link>
  );
}
