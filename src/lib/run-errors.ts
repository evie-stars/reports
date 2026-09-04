/** Translate stored worker errors into operator-facing copy for the Rank Runs page. */
export function readableRunError(error: string) {
  if (/DATAFORSEO_LOGIN|DATAFORSEO_PASSWORD|DataForSEO API credentials are not configured/.test(error)) {
    return "DataForSEO credentials were unavailable to the worker.";
  }
  if (/API key store could not be read|credentials are unreadable|stored secret has an invalid format|Unsupported state or unable to authenticate|APP_SECRETS_ENCRYPTION_KEY/.test(error)) {
    return "DataForSEO credentials could not be read from the API key store. Check the database connection and APP_SECRETS_ENCRYPTION_KEY.";
  }
  if (error.includes("DATAFORSEO_LIVE_ENABLED")) return "Paid API requests were disabled when this run started.";
  return error;
}
