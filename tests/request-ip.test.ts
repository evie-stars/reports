import assert from "node:assert/strict";
import test from "node:test";
import { clientIpFromHeaders } from "../src/lib/request-ip";

test("prefers the proxy's x-real-ip, then the first x-forwarded-for entry", () => {
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": " 203.0.113.7 ", "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1");
  assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": " 198.51.100.1 " })), "198.51.100.1");
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "", "x-forwarded-for": "" })), null);
  assert.equal(clientIpFromHeaders(new Headers()), null);
});
