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
          <Link href="/"><Icon name="home" />Dashboard</Link>
          <Link href="/clients"><Icon name="contacts" />Clients</Link>
          <Link href="/runs"><Icon name="graph" />Rank Runs</Link>
          {appRole !== "sales" ? <Link href="/settings"><Icon name="settings" />Settings</Link> : null}
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
        {children}
      </main>
    </div>
  );
}
