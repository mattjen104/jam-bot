import { describe, expect, it, vi } from "vitest";
import { IcyWatcher } from "../src/lore/icy-watcher.js";

describe("IcyWatcher transport observations", () => {
  it("reports repeated unchanged metadata blocks while keeping ingestion change-only", () => {
    const watcher = new IcyWatcher(
      "test-station",
      "https://stream.example.test/live",
    );
    const transport = vi.fn();
    const changed = vi.fn();
    watcher.on("transport-observation", transport);
    watcher.on("metadata-changed", changed);

    const invoke = watcher as unknown as {
      handleStreamTitle(value: string | null): void;
    };
    invoke.handleStreamTitle("Broadcast - Echo's Answer");
    invoke.handleStreamTitle("Broadcast - Echo's Answer");

    expect(transport).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});