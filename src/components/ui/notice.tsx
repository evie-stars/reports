import { Icon, type IconName } from "@/components/icon";

type NoticeTone = "info" | "success" | "warn" | "danger";

const CLASS: Record<NoticeTone, string> = {
  info: "notice",
  success: "notice notice-success",
  warn: "notice notice-warn",
  danger: "notice notice-danger"
};

const ICON: Record<NoticeTone, IconName> = {
  info: "help-circle",
  success: "tick-circle",
  warn: "alert-circle",
  danger: "x-circle"
};

const ICON_TINT: Record<NoticeTone, string> = {
  info: "text-sky",
  success: "text-accent",
  warn: "text-warn",
  danger: "text-blocked"
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  role
}: {
  tone?: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className={`${CLASS[tone]} mb-4`} role={role}>
      <Icon name={ICON[tone]} className={`w-4 h-4 shrink-0 ${ICON_TINT[tone]}`} />
      {title ? <strong className="font-medium">{title}</strong> : null}
      {children ? <span className="text-slate">{children}</span> : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}
