"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { isNavItemActive, type NavGroup } from "@/components/shell/nav-items";

/** Bottom tab bar for phones (hidden from md up, where the sidebar takes over). */
export function MobileNav({
  groups,
  email,
  signOutAction
}: {
  groups: NavGroup[];
  email: string;
  signOutAction: (() => Promise<void>) | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = groups.flatMap((group) => group.items);
  const bar = items.slice(0, 4);
  const more = items.slice(4);
  const moreActive = more.some((item) => isNavItemActive(item.href, pathname));

  useEffect(() => { setOpen(false); }, [pathname]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open ? (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/40" />
          <div
            role="dialog"
            aria-label="More"
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-lift pb-[calc(4.25rem+env(safe-area-inset-bottom))] pt-3 px-3 animate-fade-in-up"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            {more.length > 0 ? (
              <ul className="grid grid-cols-2 gap-2">
                {more.map((item) => {
                  const active = isNavItemActive(item.href, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-3 text-sm ${active ? "border-accent/40 bg-accent/5 text-ink font-medium" : "border-line text-slate"}`}
                      >
                        <Icon name={item.icon} className={`w-4 h-4 ${active ? "text-accent" : ""}`} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="flex items-center justify-between mt-3 px-1 text-xs text-slate">
              <span className="truncate">{email}</span>
              {signOutAction ? (
                <form action={signOutAction}>
                  <button type="submit" className="text-slate hover:text-ink py-2 pl-3">Sign out</button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <nav aria-label="Primary" className="md:hidden fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-5">
          {bar.map((item) => {
            const active = isNavItemActive(item.href, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center justify-center gap-1 h-16 text-[11px] ${active ? "text-accent font-medium" : "text-slate"}`}
                >
                  <Icon name={item.icon} className="w-5 h-5" />
                  {item.shortLabel ?? item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-haspopup="dialog"
              className={`w-full flex flex-col items-center justify-center gap-1 h-16 text-[11px] ${moreActive || open ? "text-accent font-medium" : "text-slate"}`}
            >
              <Icon name="minus" className="w-5 h-5" />
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
