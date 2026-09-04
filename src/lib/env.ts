export function configuredPositiveInteger(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function envList(name: string, env: Record<string, string | undefined> = process.env) {
  return (env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isProduction(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === "production";
}
