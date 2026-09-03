"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

  if (pathname.startsWith("/share/") || pathname === "/login") {
    return <main className="shared-main">{children}</main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <Image
            className="brand-logo"
            src="/star-websites.png"
            alt="Star Websites"
            width={684}
            height={273}
            priority
          />
          <h1>Report Hub</h1>
        </div>
        <nav>
          <NavigationLink href="/" pathname={pathname} icon="home">Dashboard</NavigationLink>
          <NavigationLink href="/clients" pathname={pathname} icon="contacts">Clients</NavigationLink>
          <NavigationLink href="/runs" pathname={pathname} icon="graph">Rank Runs</NavigationLink>
          {appRole !== "sales" ? <NavigationLink href="/settings" pathname={pathname} icon="settings">Settings</NavigationLink> : null}
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
            <span className="status good">API guardrails active</span>
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
  pathname
}: {
  children: React.ReactNode;
  href: string;
  icon: "home" | "contacts" | "graph" | "settings";
  pathname: string;
}) {
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link className={active ? "active" : undefined} href={href} aria-current={active ? "page" : undefined}>
      <Icon name={icon} />{children}
    </Link>
  );
}
