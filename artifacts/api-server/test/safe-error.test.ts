import { describe, expect, it } from "vitest";
import { safeFailureMessage } from "../src/lore/safe-error.js";

describe("safeFailureMessage", () => {
  it.each([
    ["unknown URL query", "GET https://example.test/path?provider_value=query-secret", "query-secret"],
    ["URL basic auth", "GET https://user:basic-secret@example.test/path", "basic-secret"],
    ["client underscore secret", "client_secret=client-secret", "client-secret"],
    ["client dash secret", "client-secret=client-dash-secret", "client-dash-secret"],
    ["API key header", "x-api-key: header-secret", "header-secret"],
    ["bearer authorization", "Authorization: Bearer abc.def", "abc.def"],
    [
      "multi-part authorization",
      "Authorization: ApiKey actual-secret signed-field=second-secret",
      "actual-secret",
    ],
    [
      "multi-part authorization suffix",
      "Authorization: ApiKey actual-secret signed-field=second-secret",
      "second-secret",
    ],
    ["cookie header", "Cookie: session=browser-secret", "browser-secret"],
    ["JWT", "provider failed eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.c2lnbmF0dXJl", "c2VjcmV0"],
  ])("redacts %s", (_label, input, secret) => {
    const output = safeFailureMessage(input);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(secret);
  });
});