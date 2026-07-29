/**
 * HTTP unit tests for the admin router's security middleware, exercised
 * WITHOUT a database. Both the rate limiter and the auth gate run before any
 * route handler (and therefore before any DB access), so these assertions hold
 * regardless of whether Postgres is reachable:
 *
 *   1. AUTH — the token gate applies to EVERY admin route (GET and mutating
 *      alike): a request with no/invalid token is rejected 401 before it can
 *      reach a handler, and when LORE_ADMIN_TOKEN is unset the router answers
 *      503 ("not configured") rather than silently allowing access.
 *
 *   2. RATE LIMIT — the 10-per-15-minutes limiter is scoped to state-mutating
 *      methods only. Read-only GETs (which the admin dashboard polls every 30s)
 *      are never throttled, while POST/PATCH/PUT/DELETE still trip the limit.
 *
 * The limiter runs before the auth gate, so we can drive it with UNauthenticated
 * requests: those never reach a handler (hence never touch the DB). A GET that
 * is exempt from the limiter falls through to the auth gate and returns 401; a
 * mutating request that exceeds the budget returns 429 from the limiter itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { createServer } from "node:http";

// Must be set before the admin router module is imported so the auth
// middleware closes over the configured token.
const ADMIN_TOKEN = `test-admin-${randomUUID().slice(0, 8)}`;
process.env.LORE_ADMIN_TOKEN = ADMIN_TOKEN;

let serverUrl = "";
let server: ReturnType<typeof createServer> | null = null;

beforeAll(async () => {
  const { default: adminRouter } = await import("../src/routes/lore/admin.js");
  const app = express();
  app.use(express.json());
  app.use(adminRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

describe("admin auth gate", () => {
  it("rejects a GET with no admin token (401) before reaching a handler", async () => {
    const res = await fetch(`${serverUrl}/admin/feed-freshness-health`);
    expect(res.status).toBe(401);
  });

  it("rejects a GET with an invalid admin token (401)", async () => {
    const res = await fetch(`${serverUrl}/admin/feed-freshness-health`, {
      headers: { "x-admin-token": "not-the-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a mutating request with no admin token (401)", async () => {
    const res = await fetch(`${serverUrl}/admin/pickers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe("admin rate limiter scoping", () => {
  it("does NOT throttle read-only GETs (dashboard polling stays 401, never 429)", async () => {
    // Well beyond the 10-per-15-minutes budget. If GETs were still limited,
    // some of these would return 429 within a single window.
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${serverUrl}/admin/spinitron-web-health`);
      statuses.push(res.status);
    }
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect(statuses).not.toContain(429);
  });

  it("still throttles mutating requests once the budget is exhausted", async () => {
    // Auth is deliberately absent: the limiter runs before the auth gate, so
    // these requests are counted and then blocked without ever reaching a
    // handler or the database. Under-budget calls return 401 (auth), and once
    // the 10-per-window budget is spent the limiter returns 429.
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${serverUrl}/admin/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    // The first request (fresh window) must not itself be a 429.
    expect(statuses[0]).toBe(401);
  });
});
