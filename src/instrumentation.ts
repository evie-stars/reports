export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertAuthenticationConfigured } = await import("@/lib/startup-checks");
  assertAuthenticationConfigured();
}
