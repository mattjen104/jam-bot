import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  isPublicResolvedAddress,
  readPinnedHttpsHtml,
  resolvePublicMerchAddresses,
  type MerchPinnedRequestFn,
} from "../src/lore/artist-merch.js";

describe("pinned artist merch source fetching", () => {
  it("rejects private, reserved, and mixed DNS answers", async () => {
    await expect(resolvePublicMerchAddresses("private.test", async () => [
      { address: "192.168.1.20", family: 4 },
    ])).rejects.toThrow(/public addresses/);
    await expect(resolvePublicMerchAddresses("private-v6.test", async () => [
      { address: "fd00::20", family: 6 },
    ])).rejects.toThrow(/public addresses/);
    await expect(resolvePublicMerchAddresses("mapped.test", async () => [
      { address: "::ffff:10.0.0.20", family: 6 },
    ])).rejects.toThrow(/public addresses/);
    await expect(resolvePublicMerchAddresses("none.test", async () => [])).rejects.toThrow(
      /public addresses/,
    );
    await expect(resolvePublicMerchAddresses("mixed.test", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])).rejects.toThrow(/public addresses/);

    expect(isPublicResolvedAddress("100.64.0.1", 4)).toBe(false);
    expect(isPublicResolvedAddress("169.254.1.1", 4)).toBe(false);
    expect(isPublicResolvedAddress("2001:db8::1", 6)).toBe(false);
    expect(isPublicResolvedAddress("ff02::1", 6)).toBe(false);
  });

  it("pins the validated address while retaining HTTPS hostname/SNI", async () => {
    const response = new PassThrough() as PassThrough & {
      statusCode?: number;
      headers: Record<string, string>;
    };
    response.statusCode = 200;
    response.headers = { "content-type": "text/html" };
    let captured: {
      hostname?: string;
      servername?: string;
      pinned?: string;
      pinnedAll?: Array<{ address: string; family: number }>;
    } = {};
    let requestDestroyed = false;
    const requestFn: MerchPinnedRequestFn = (options, callback) => {
      captured = {
        hostname: options.hostname?.toString(),
        servername: options.servername,
      };
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const lookup = options.lookup!;
        lookup("shop.example", {}, (error, address) => {
          if (error) throw error;
          captured.pinned = address as string;
          lookup("shop.example", { all: true }, (allError, addresses) => {
            if (allError) throw allError;
            captured.pinnedAll = addresses as Array<{ address: string; family: number }>;
          });
          callback(response as unknown as IncomingMessage);
          response.end("<a href='/shirt'>Official merch</a>");
        });
      }) as ClientRequest["end"];
      request.destroy = ((error?: Error) => {
        requestDestroyed = true;
        if (error) request.emit("error", error);
        return request;
      }) as ClientRequest["destroy"];
      return request;
    };

    const result = await readPinnedHttpsHtml("https://shop.example/store", {
      timeoutMs: 1000,
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      requestFn,
    });
    expect(result.html).toContain("Official merch");
    expect(captured).toEqual({
      hostname: "shop.example",
      servername: "shop.example",
      pinned: "93.184.216.34",
      pinnedAll: [{ address: "93.184.216.34", family: 4 }],
    });
    expect(requestDestroyed).toBe(false);
  });

  it("rejects redirects and destroys an oversized response immediately", async () => {
    const makeRequest = (statusCode: number, body: Buffer | Buffer[]): {
      requestFn: MerchPinnedRequestFn;
      wasDestroyed: () => boolean;
    } => {
      let destroyed = false;
      const requestFn: MerchPinnedRequestFn = (_options, callback) => {
        const response = new PassThrough() as PassThrough & {
          statusCode?: number;
          headers: Record<string, string>;
        };
        response.statusCode = statusCode;
        response.headers = { "content-type": "text/html" };
        const request = new EventEmitter() as ClientRequest;
        request.end = (() => {
          callback(response as unknown as IncomingMessage);
          const chunks = Array.isArray(body) ? body : [body];
          for (const chunk of chunks.slice(0, -1)) response.write(chunk);
          response.end(chunks[chunks.length - 1]);
        }) as ClientRequest["end"];
        request.destroy = ((error?: Error) => {
          destroyed = true;
          if (error) request.emit("error", error);
          return request;
        }) as ClientRequest["destroy"];
        return request;
      };
      return { requestFn, wasDestroyed: () => destroyed };
    };

    const redirect = makeRequest(302, Buffer.from("redirect"));
    await expect(readPinnedHttpsHtml("https://shop.example/store", {
      timeoutMs: 1000,
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      requestFn: redirect.requestFn,
    })).rejects.toThrow(/redirects/);
    expect(redirect.wasDestroyed()).toBe(true);

    const oversized = makeRequest(200, [
      Buffer.alloc(700_000, "x"),
      Buffer.alloc(400_001, "x"),
    ]);
    await expect(readPinnedHttpsHtml("https://shop.example/store", {
      timeoutMs: 1000,
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      requestFn: oversized.requestFn,
    })).rejects.toThrow(/1MB/);
    expect(oversized.wasDestroyed()).toBe(true);
  });
});