import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className = ""
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-6 ${className}`}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-2xl leading-tight">{title}</h1>
        {subtitle ? <p className="text-slate text-sm mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:max-w-[62%]">{actions}</div> : null}
    </div>
  );
}
