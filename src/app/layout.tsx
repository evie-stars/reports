import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Star Reports",
  description: "Local SEO rank tracking and reporting hub"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div>
              <p className="eyebrow">Star Reports</p>
              <h1>Local SEO Hub</h1>
            </div>
            <nav>
              <Link href="/">Dashboard</Link>
              <Link href="/clients">Clients</Link>
              <Link href="/runs">Rank Runs</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
