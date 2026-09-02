import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icon";
import "./globals.css";

export const metadata: Metadata = {
  title: "Star Reports",
  description: "Local SEO rank tracking and reporting hub"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
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
              <Link href="/settings"><Icon name="settings" />Settings</Link>
            </nav>
          </aside>
          <main>
            <div className="topbar">
              <span>reports.starwebsites.co.uk</span>
              <span className="status good">Sandbox protected</span>
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
