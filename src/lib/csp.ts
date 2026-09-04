/**
 * Content Security Policy used for every HTML response.
 *
 * Scripts are only allowed when they carry the per-request nonce (Next.js attaches it to its
 * own bootstrap and chunk loaders). `strict-dynamic` lets those trusted scripts load further
 * chunks without listing every hashed file name. Inline style attributes remain allowed because
 * React and the charts set widths and animation delays inline; styles cannot execute code.
 */
export function buildContentSecurityPolicy(nonce: string, options: { development?: boolean } = {}) {
  const development = options.development ?? false;
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    ...(development ? [] : ["upgrade-insecure-requests"])
  ];
  return directives.join("; ");
}

export function generateNonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
