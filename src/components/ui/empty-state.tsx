import { Icon, type IconName } from "@/components/icon";

export function EmptyState({
  title,
  children,
  icon = "drawer",
  action,
  compact = false
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  icon?: IconName;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "py-5" : "py-10"} px-4`}>
      <span className="grid place-items-center w-10 h-10 rounded-xl bg-line/60 text-slate mb-3">
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <p className="text-sm text-slate mt-1 max-w-md">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
