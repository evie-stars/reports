import { readableValue, statusTone, type Tone } from "@/lib/format";

const STYLES: Record<Tone, string> = {
  accent: "border-accent text-accent bg-accent/5",
  sky: "border-sky text-sky bg-sky/5",
  warn: "border-warn text-warn bg-warn/5",
  blocked: "border-blocked text-blocked bg-blocked/5",
  default: "border-line text-slate bg-white"
};

/** A coloured pill. Pass `status` to derive the tone from a known state, or set `tone` directly. */
export function StatusPill({
  status,
  tone,
  children,
  dot = true,
  className = ""
}: {
  status?: string;
  tone?: Tone;
  children?: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const resolvedTone = tone ?? (status ? statusTone(status) : "default");
  return (
    <span className={`status-pill ${STYLES[resolvedTone]} ${className}`}>
      {dot ? <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" /> : null}
      {children ?? (status ? readableValue(status) : null)}
    </span>
  );
}
