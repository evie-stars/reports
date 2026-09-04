import assert from "node:assert/strict";
import test from "node:test";
import { DATAFORSEO_CREDENTIALS_MISSING_MESSAGE } from "../src/lib/dataforseo";
import { readableRunError } from "../src/lib/run-errors";

test("maps missing and unreadable credential failures to operator-facing copy", () => {
  assert.equal(readableRunError(DATAFORSEO_CREDENTIALS_MISSING_MESSAGE), "DataForSEO credentials were unavailable to the worker.");
  assert.equal(readableRunError("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD."), "DataForSEO credentials were unavailable to the worker.");
  for (const stored of [
    "The API key store could not be read for DataForSEO: Can't reach database server at `127.0.0.1:5432`",
    "The stored DataForSEO credentials are unreadable. Check APP_SECRETS_ENCRYPTION_KEY or save them again.",
    "The stored secret has an invalid format.",
    "Unsupported state or unable to authenticate data",
    "APP_SECRETS_ENCRYPTION_KEY must be a 64-character hexadecimal value (generate one with: openssl rand -hex 32)."
  ]) {
    assert.match(readableRunError(stored), /could not be read from the API key store/);
  }
  assert.equal(readableRunError("Paid DataForSEO calls are blocked. Set DATAFORSEO_LIVE_ENABLED=true to allow them."), "Paid API requests were disabled when this run started.");
  assert.equal(readableRunError("Task Not Found."), "Task Not Found.");
});
