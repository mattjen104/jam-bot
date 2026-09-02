import test from "node:test";
import assert from "node:assert/strict";
import { helperAuthHeaders } from "./helper-auth.mjs";

test("room token wins over the legacy global secret", () => {
  assert.deepEqual(helperAuthHeaders("room", "legacy"), { Authorization: "Bearer room" });
});

test("legacy helper remains compatible", () => {
  assert.deepEqual(helperAuthHeaders("", "legacy"), { "X-Turntable-Secret": "legacy" });
});