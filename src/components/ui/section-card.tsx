import { Icon, type IconName } from "@/components/icon";

/** A white card with the Team Hub tile header: small icon, title, optional subtitle, and a right-hand slot. */
export function SectionCard({
  title,
  subtitle,
  icon,
  aside,
  id,
  className = "",
  bodyClassName = "",
  children
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: IconName;
  aside?: React.ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card flex flex-col ${className}`} id={id}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="font-display text-base flex items-center gap-2">
            {icon ? <Icon name={icon} className="w-4 h-4 text-slate shrink-0" /> : null}
            <span className="truncate">{title}</span>
          </h2>
          {subtitle ? <p className="text-xs text-slate mt-0.5">{subtitle}</p> : null}
        </div>
        {aside ? <div className="shrink-0 flex items-center gap-2">{aside}</div> : null}
      </div>
      <div className={`flex-1 min-w-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
