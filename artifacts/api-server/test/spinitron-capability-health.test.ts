// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import express from "express";

const API_KEY = "spinitron-api-key-must-not-leak";
const ACCESS_TOKEN = "spinitron-access-token-must-not-leak";

const {
  mockDbSelect,
  mockDbExecute,
  mockGetObservabilityHealth,
  mockGetIcyMetadataCandidateHealth,
  mockGetSpeechPilotAdminStatus,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbExecute: vi.fn(),
  mockGetObservabilityHealth: vi.fn(),
  mockGetIcyMetadataCandidateHealth: vi.fn(),
  mockGetSpeechPilotAdminStatus: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: mockDbSelect,
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      execute: mockDbExecute,
    },
  };
});

vi.mock("../src/lore/observability.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lore/observability.js")
  >();
  return {
    ...actual,
    getObservabilityHealth: mockGetObservabilityHealth,
    getIcyMetadataCandidateHealth: mockGetIcyMetadataCandidateHealth,
  };
});

vi.mock("../src/lore/speech-shadow-orchestrator.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lore/speech-shadow-orchestrator.js")
  >();
  return {
    ...actual,
    getSpeechPilotAdminStatus: mockGetSpeechPilotAdminStatus,
  };
});

const ADMIN_TOKEN = `test-spinitron-health-${randomUUID().slice(0, 8)}`;
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
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

function mockStationRows(rows: Array<Record<string, unknown>>) {
  mockDbSelect.mockReturnValueOnce({
    from: () => ({
      leftJoin: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    }),
  });
}

describe("GET /admin/spinitron-capability-health", () => {
  it("returns capability booleans without exposing station credentials or raw config", async () => {
    const failureAt = new Date("2026-09-06T01:00:00.000Z");
    mockStationRows([
      {
        stationId: 61701,
        stationSlug: "credentialed-fm",
        stationName: "Credentialed FM",
        source: "spinitron",
        scheduleAttemptedAt: null,
        scheduleFailureAt: null,
        scheduleFailureReason: null,
        sourceLastOutcome: "response_error",
        sourceLastDetail:
          `Spinitron request failed: https://spinitron.com/api/spins?access-token=${ACCESS_TOKEN}`,
        sourceLastAttemptAt: failureAt,
        config: {
          apiKey: API_KEY,
          accessToken: ACCESS_TOKEN,
          callsign: "CRED",
          stationHandle: "credentialed",
          nestedCredential: { secret: "also-must-not-leak" },
        },
      },
      {
        stationId: 61702,
        stationSlug: "legacy-fm",
        stationName: "Legacy FM",
        source: "spinitron_web",
        scheduleAttemptedAt: failureAt,
        scheduleFailureAt: failureAt,
        scheduleFailureReason:
          `Schedule failed with apiKey=${API_KEY}`,
        sourceLastOutcome: null,
        sourceLastDetail: null,
        sourceLastAttemptAt: null,
        config: { callsign: "OLD" },
      },
      {
        stationId: 61703,
        stationSlug: "partial-fm",
        stationName: "Partial FM",
        source: "spinitron_web",
        scheduleAttemptedAt: null,
        scheduleFailureAt: null,
        scheduleFailureReason: null,
        sourceLastOutcome: null,
        sourceLastDetail: null,
        sourceLastAttemptAt: null,
        config: null,
      },
    ]);
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${serverUrl}/admin/spinitron-capability-health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      stations: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };

    expect(body.stations).toEqual([
      {
        stationId: 61701,
        stationSlug: "credentialed-fm",
        stationName: "Credentialed FM",
        source: "spinitron",
        capabilities: {
          publicLiveMetadata: false,
          publicSchedule: true,
          authenticatedHistory: true,
          historyStatus: "available",
          directoryCoverage: "public_fallback",
        },
        attribution: {
          status: "failed",
          latestSpinAt: null,
          latestAttributionAt: null,
          staleAfterMs: 1_800_000,
          lastAttemptAt: failureAt.toISOString(),
          failure: {
            at: failureAt.toISOString(),
            reason: "provider_response_error",
          },
        },
      },
      {
        stationId: 61702,
        stationSlug: "legacy-fm",
        stationName: "Legacy FM",
        source: "spinitron_web",
        capabilities: {
          publicLiveMetadata: true,
          publicSchedule: true,
          authenticatedHistory: false,
          historyStatus: "not_configured",
          directoryCoverage: "public_fallback",
        },
        attribution: {
          status: "failed",
          latestSpinAt: null,
          latestAttributionAt: null,
          staleAfterMs: 600_000,
          lastAttemptAt: null,
          failure: {
            at: failureAt.toISOString(),
            reason: "schedule_fetch_failed",
          },
        },
      },
      {
        stationId: 61703,
        stationSlug: "partial-fm",
        stationName: "Partial FM",
        source: "spinitron_web",
        capabilities: {
          publicLiveMetadata: true,
          publicSchedule: false,
          authenticatedHistory: false,
          historyStatus: "not_configured",
          directoryCoverage: "public_fallback",
        },
        attribution: {
          status: "public_only",
          latestSpinAt: null,
          latestAttributionAt: null,
          staleAfterMs: 600_000,
          lastAttemptAt: null,
          failure: null,
        },
      },
    ]);
    expect(body.totals).toEqual({
      stations: 3,
      publicLiveMetadata: 2,
      publicSchedule: 2,
      authenticatedHistory: 1,
      historyNotConfigured: 2,
      healthyAttribution: 0,
      staleAttribution: 0,
      failedAttribution: 2,
      attributionNotProduced: 0,
      publicOnly: 1,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain("also-must-not-leak");
    expect(serialized).not.toMatch(/"(apiKey|accessToken|nestedCredential|config)"\s*:/i);
  });
});

describe("GET /admin/observability/health", () => {
  it("keeps nested Spinitron capability data operator-safe", async () => {
    const failureAt = new Date("2026-09-06T02:00:00.000Z");
    mockGetObservabilityHealth.mockResolvedValueOnce([]);
    mockGetIcyMetadataCandidateHealth.mockResolvedValueOnce({
      windowDays: 30,
      metrics: [],
      recent: [],
    });
    mockGetSpeechPilotAdminStatus.mockResolvedValueOnce({
      enabled: false,
    });
    mockStationRows([
      {
        stationId: 61704,
        stationSlug: "combined-health-fm",
        stationName: "Combined Health FM",
        source: "spinitron",
        scheduleAttemptedAt: null,
        scheduleFailureAt: null,
        scheduleFailureReason: null,
        sourceLastOutcome: "response_error",
        sourceLastDetail:
          `Provider rejected apiKey=${API_KEY}&access-token=${ACCESS_TOKEN}`,
        sourceLastAttemptAt: failureAt,
        config: {
          apiKey: API_KEY,
          accessToken: ACCESS_TOKEN,
          callsign: "SAFE",
          token: "fixture-token-must-not-leak",
          nestedCredential: { secret: "fixture-secret-must-not-leak" },
        },
      },
    ]);
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const response = await fetch(`${serverUrl}/admin/observability/health`, {
      headers: { "x-admin-token": ADMIN_TOKEN },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      metrics: unknown[];
      icyMetadataCandidates: Record<string, unknown>;
      speechPilot: Record<string, unknown>;
      spinitronCapabilities: {
        stations: Array<Record<string, unknown>>;
        totals: Record<string, number>;
      };
    };

    expect(body.metrics).toEqual([]);
    expect(body.icyMetadataCandidates).toEqual({
      windowDays: 30,
      metrics: [],
      recent: [],
    });
    expect(body.speechPilot).toEqual({ enabled: false });
    expect(body.spinitronCapabilities.stations).toEqual([
      {
        stationId: 61704,
        stationSlug: "combined-health-fm",
        stationName: "Combined Health FM",
        source: "spinitron",
        capabilities: {
          publicLiveMetadata: false,
          publicSchedule: true,
          authenticatedHistory: true,
          historyStatus: "available",
          directoryCoverage: "public_fallback",
        },
        attribution: {
          status: "failed",
          latestSpinAt: null,
          latestAttributionAt: null,
          staleAfterMs: 1_800_000,
          lastAttemptAt: failureAt.toISOString(),
          failure: {
            at: failureAt.toISOString(),
            reason: "provider_response_error",
          },
        },
      },
    ]);
    expect(body.spinitronCapabilities.totals).toMatchObject({
      stations: 1,
      authenticatedHistory: 1,
      failedAttribution: 1,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain("fixture-token-must-not-leak");
    expect(serialized).not.toContain("fixture-secret-must-not-leak");
    expect(serialized).not.toMatch(
      /"(config|apiKey|accessToken|token|nestedCredential|secret)"\s*:/i,
    );
  });
});