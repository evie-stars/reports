import Link from "next/link";

export type TabItem = { key: string; label: string; href: string };

export function Tabs({ items, active, ariaLabel }: { items: TabItem[]; active: string; ariaLabel?: string }) {
  return (
    <nav className="flex gap-1 border-b border-line mb-6 overflow-x-auto" aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`px-4 py-2 text-sm -mb-px border-b-2 whitespace-nowrap transition-colors ${isActive ? "border-accent text-ink font-medium" : "border-transparent text-slate hover:text-ink"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
