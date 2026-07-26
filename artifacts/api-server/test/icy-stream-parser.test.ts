import { describe, it, expect } from "vitest";
import { IcyStreamParser } from "../src/lore/icy.js";

/** Build a metadata block: 1 length byte + NUL-padded StreamTitle payload. */
function metaBlock(streamTitle: string | null): Buffer {
  if (streamTitle === null) return Buffer.from([0]);
  const payload = Buffer.from(`StreamTitle='${streamTitle}';`, "utf8");
  const blocks = Math.ceil(payload.length / 16);
  const block = Buffer.alloc(1 + blocks * 16);
  block[0] = blocks;
  payload.copy(block, 1);
  return block;
}

function headers(metaint: number | null): Buffer {
  const lines = ["ICY 200 OK"];
  if (metaint !== null) lines.push(`icy-metaint:${metaint}`);
  return Buffer.from(lines.join("\r\n") + "\r\n\r\n");
}

const audio = (n: number) => Buffer.alloc(n, 0xaa);

describe("IcyStreamParser", () => {
  it("parses headers then metadata across a single chunk", () => {
    const p = new IcyStreamParser();
    const chunk = Buffer.concat([
      headers(16),
      audio(16),
      metaBlock("Artist - Song"),
    ]);
    const events = p.feed(chunk);
    expect(events).toEqual([
      { type: "headers", icyMetaint: 16 },
      { type: "metadata", streamTitle: "Artist - Song" },
    ]);
  });

  it("handles metadata split across arbitrary chunk boundaries", () => {
    const p = new IcyStreamParser();
    const full = Buffer.concat([
      headers(32),
      audio(32),
      metaBlock("Boards of Canada - Roygbiv"),
      audio(32),
      metaBlock("Aphex Twin - Xtal"),
    ]);
    const events: unknown[] = [];
    // Feed one byte at a time — worst-case fragmentation.
    for (let i = 0; i < full.length; i++) {
      events.push(...p.feed(full.slice(i, i + 1)));
    }
    expect(events).toEqual([
      { type: "headers", icyMetaint: 32 },
      { type: "metadata", streamTitle: "Boards of Canada - Roygbiv" },
      { type: "metadata", streamTitle: "Aphex Twin - Xtal" },
    ]);
  });

  it("skips zero-length metadata blocks without emitting", () => {
    const p = new IcyStreamParser();
    const chunk = Buffer.concat([
      headers(8),
      audio(8),
      metaBlock(null), // zero-length: no update
      audio(8),
      metaBlock("X - Y"),
    ]);
    const events = p.feed(chunk);
    expect(events).toEqual([
      { type: "headers", icyMetaint: 8 },
      { type: "metadata", streamTitle: "X - Y" },
    ]);
  });

  it("errors on missing icy-metaint", () => {
    const p = new IcyStreamParser();
    const events = p.feed(Buffer.concat([headers(null), audio(64)]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", kind: "icy_unsupported" });
    // Parser is dead afterwards.
    expect(p.feed(audio(64))).toEqual([]);
  });

  it("errors on non-2xx status", () => {
    const p = new IcyStreamParser();
    const events = p.feed(
      Buffer.from("HTTP/1.0 302 Found\r\nLocation: elsewhere\r\n\r\n"),
    );
    expect(events).toEqual([
      { type: "error", kind: "icy_unsupported", message: "HTTP 302" },
    ]);
  });

  it("keeps a long-running stream without accumulating (many cycles)", () => {
    const p = new IcyStreamParser();
    let events: ReturnType<IcyStreamParser["feed"]> = p.feed(headers(1024));
    expect(events).toEqual([{ type: "headers", icyMetaint: 1024 }]);
    for (let i = 0; i < 500; i++) {
      events = p.feed(Buffer.concat([audio(1024), metaBlock(`T - ${i}`)]));
      expect(events).toEqual([
        { type: "metadata", streamTitle: `T - ${i}` },
      ]);
    }
  });

  it("emits null streamTitle when metadata block has no StreamTitle", () => {
    const p = new IcyStreamParser();
    const payload = Buffer.from("StreamUrl='http://x';", "utf8");
    const blocks = Math.ceil(payload.length / 16);
    const block = Buffer.alloc(1 + blocks * 16);
    block[0] = blocks;
    payload.copy(block, 1);
    const events = p.feed(Buffer.concat([headers(4), audio(4), block]));
    expect(events).toEqual([
      { type: "headers", icyMetaint: 4 },
      { type: "metadata", streamTitle: null },
    ]);
  });
});
