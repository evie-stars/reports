import type { CSSProperties } from "react";

type IconName = "contacts" | "graph" | "home" | "location" | "settings" | "tags";

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className="icon"
      style={{ "--icon-url": `url(/icons/${name}.svg)` } as CSSProperties}
    />
  );
}
