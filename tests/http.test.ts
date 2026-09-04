import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTimeout, HttpTimeoutError, readJsonResponse } from "../src/lib/http";

const noSleep = async () => {};

test("retries retryable statuses up to the configured number of attempts", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(calls < 3 ? "busy" : '{"ok":true}', { status: calls < 3 ? 503 : 200 });
  }) as typeof fetch;

  const response = await fetchWithTimeout("https://api.example.com/v3/thing", { fetchImpl, retries: 2, sleep: noSleep });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test("does not retry when retries is zero, even for a retryable status", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("busy", { status: 503 });
  }) as typeof fetch;

  const response = await fetchWithTimeout("https://api.example.com/v3/task_post", { fetchImpl, sleep: noSleep });
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});

test("aborts a hung request after the timeout", async () => {
  const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

  await assert.rejects(
    fetchWithTimeout("https://api.example.com/v3/slow", { fetchImpl, timeoutMs: 20, sleep: noSleep }),
    (error: unknown) => error instanceof HttpTimeoutError && /timed out/.test(error.message)
  );
});

test("surfaces the HTTP status when a provider returns a non-JSON error page", async () => {
  await assert.rejects(
    readJsonResponse(new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })),
    /Non-JSON response \(HTTP 502, text\/html\)/
  );
  assert.equal(await readJsonResponse(new Response(null, { status: 204 })), null);
  assert.deepEqual(await readJsonResponse(new Response('{"cost":0.1}', { status: 200 })), { cost: 0.1 });
});
