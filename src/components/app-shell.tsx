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
          <span>reports.starwebsites.co.uk</span>
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
