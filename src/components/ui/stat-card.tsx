import { Icon, type IconName } from "@/components/icon";
import type { Tone } from "@/lib/format";

const TINT: Record<Tone, string> = {
  accent: "text-accent bg-accent/10",
  sky: "text-sky bg-sky/10",
  blocked: "text-blocked bg-blocked/10",
  warn: "text-warn bg-warn/10",
  default: "text-slate bg-line/60"
};

const VALUE: Record<Tone, string> = {
  accent: "text-accent",
  sky: "text-sky",
  blocked: "text-blocked",
  warn: "text-warn",
  default: "text-ink"
};

export function StatCard({
  label,
  value,
  icon,
  tone = "default",
  detail
}: {
  label: string;
  value: string | number;
  icon: IconName;
  tone?: Tone;
  detail?: string;
}) {
  return (
    <div className="card px-3.5 py-3 flex items-center gap-3 min-w-[132px] transition-shadow hover:shadow-lift">
      <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${TINT[tone]}`}>
        <Icon name={icon} className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className={`text-xl font-display font-semibold leading-none ${VALUE[tone]}`}>{value}</p>
        <p className="text-xs text-slate mt-1 leading-tight">{label}</p>
        {detail ? <p className="text-[11px] text-slate/80 leading-tight mt-0.5">{detail}</p> : null}
      </div>
    </div>
  );
}
