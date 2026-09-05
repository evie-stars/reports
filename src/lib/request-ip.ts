/**
 * The caller's address as seen through the Plesk/nginx proxy in front of the app. `x-real-ip` is
 * set by that proxy; `x-forwarded-for` lists the client first. Neither header can be trusted from a
 * direct connection, but the app is only ever reached through the proxy in production.
 */
export function clientIpFromHeaders(headers: Headers) {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}
