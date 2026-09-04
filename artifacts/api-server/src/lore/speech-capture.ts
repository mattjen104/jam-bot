import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { TimestampedTranscriptSegment } from "./speech-grounding.js";

export interface LocalCommandResult {
  stdout: string;
  stderr: string;
  /** Optional measurement reported by a local runner/test harness. */
  cpuMs?: number;
  maxMemoryBytes?: number;
}
export type LocalCommandRunner = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  budget?: { maxCpuMs?: number; maxMemoryBytes?: number },
  signal?: AbortSignal,
) => Promise<LocalCommandResult>;

function runLocalCommand(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  budget?: { maxCpuMs?: number; maxMemoryBytes?: number },
  signal?: AbortSignal,
): Promise<LocalCommandResult> {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== "win32";
    const child = spawn(executable, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      detached,
    });
    let stdout = "";
    let stderr = "";
    let cpuMs = 0;
    let maxMemoryBytes = 0;
    let budgetExceeded = false;
    let timeoutError: Error | undefined;
    let abortError: Error | undefined;
    const maxOutputBytes = 1_000_000;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(resourceTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ stdout, stderr, cpuMs, maxMemoryBytes });
    };
    const killChild = () => {
      try {
        if (detached && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timeoutError = new Error(`local command timed out after ${timeoutMs}ms`);
      killChild();
    }, timeoutMs);
    const resourceTimer = setInterval(() => {
      void Promise.all([
        readFile(`/proc/${child.pid}/stat`, "utf8"),
        readFile(`/proc/${child.pid}/status`, "utf8"),
      ]).then(([statValue, status]) => {
        const fields = statValue.slice(statValue.lastIndexOf(")") + 2).split(" ");
        // Linux exposes child CPU ticks at fields 14/15; USER_HZ is 100 on Replit.
        cpuMs = Math.max(cpuMs, ((Number(fields[11]) || 0) + (Number(fields[12]) || 0)) * 10);
        const memoryKb = Number(/^VmHWM:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0);
        maxMemoryBytes = Math.max(maxMemoryBytes, memoryKb * 1024);
        if (!budgetExceeded &&
          ((budget?.maxCpuMs != null && cpuMs > budget.maxCpuMs) ||
            (budget?.maxMemoryBytes != null && maxMemoryBytes > budget.maxMemoryBytes))) {
          budgetExceeded = true;
          killChild();
        }
      }).catch(() => undefined);
    }, 100);
    resourceTimer.unref();
    const onAbort = () => {
      abortError = new Error("local command aborted");
      killChild();
    };
    const append = (current: string, data: Buffer) => {
      const next = current + data.toString();
      if (Buffer.byteLength(next) > maxOutputBytes) {
        killChild();
        finish(new Error(`local command exceeded ${maxOutputBytes} byte output limit`));
      }
      return next;
    };
    child.stdout.on("data", (data: Buffer) => { stdout = append(stdout, data); });
    child.stderr.on("data", (data: Buffer) => { stderr = append(stderr, data); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(abortError ?? timeoutError ?? (code === 0 || budgetExceeded ? undefined : new Error(`${executable} exited ${code}`))));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface SpeechCaptureConfig {
  ffmpegExecutable?: string;
  durationSeconds: number;
  timeoutMs: number;
  maxBytes?: number;
  /** Original authority retained after DNS pinning for HTTP Host and TLS verification. */
  originalAuthority?: string;
  originalHostname?: string;
  /** A directory supplied by the process owner, or the OS temp directory. */
  tempRoot?: string;
  signal?: AbortSignal;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const a = octets[0] ?? Number.NaN;
  const b = octets[1] ?? Number.NaN;
  const c = octets[2] ?? Number.NaN;
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 192 && b === 0 && (c === 0 || c === 2)) &&
    !(a === 192 && b === 88 && c === 99) &&
    !(a === 198 && (b === 18 || b === 19 || b === 51)) &&
    !(a === 203 && b === 0 && c === 113);
}

/** Parse a validated IPv6 literal into a canonical 128-bit value. */
function ipv6Value(address: string): bigint | null {
  let value = address.toLowerCase().split("%", 1)[0]!;
  if (value.includes(".")) {
    const colon = value.lastIndexOf(":");
    const octets = value.slice(colon + 1).split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    value = `${value.slice(0, colon)}:${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Cidr(value: bigint, base: string, prefix: number): boolean {
  const baseValue = ipv6Value(base);
  if (baseValue == null) return false;
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (baseValue >> shift);
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) !== 6) return false;
  const value = ipv6Value(address);
  if (value == null) return false;

  // Decode IPv4-mapped IPv6 canonically, including expanded/hex forms.
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = Number(value & 0xffff_ffffn);
    return isPublicIpv4([
      (ipv4 >>> 24) & 255,
      (ipv4 >>> 16) & 255,
      (ipv4 >>> 8) & 255,
      ipv4 & 255,
    ].join("."));
  }

  const nonGlobalRanges: Array<[string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2002::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];
  return !nonGlobalRanges.some(([base, prefix]) => inIpv6Cidr(value, base, prefix));
}

/** Resolve before handing a URL to ffmpeg. Redirects are disabled in ffmpeg. */
export interface ValidatedPublicStreamTarget {
  /** URL rewritten to the validated literal address, preventing DNS rebinding. */
  pinnedUrl: string;
  originalAuthority: string;
  originalHostname: string;
}

export async function assertPublicHttpStreamUrl(
  rawUrl: string,
  resolve: typeof lookup = lookup,
): Promise<ValidatedPublicStreamTarget> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("stream URL is invalid"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("stream URL must use http(s)");
  }
  if (parsed.username || parsed.password) throw new Error("stream URL must not contain credentials");
  const addresses = await resolve(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("stream URL resolves to a non-public address");
  }
  const selected = addresses[0]!.address;
  const pinned = new URL(parsed);
  pinned.hostname = isIP(selected) === 6 ? `[${selected}]` : selected;
  return {
    pinnedUrl: pinned.toString(),
    originalAuthority: parsed.host,
    originalHostname: parsed.hostname,
  };
}

export interface CapturedSpeechClip {
  path: string;
  startedAt: Date;
  endedAt: Date;
}

/**
 * Capture only within `use`. The clip's directory is removed in finally on
 * success, ffmpeg failure, or STT failure; consumers must not retain its path.
 */
export async function withTransientSpeechClip<T>(
  streamUrl: string,
  config: SpeechCaptureConfig,
  use: (clip: CapturedSpeechClip) => Promise<T>,
  runner: LocalCommandRunner = runLocalCommand,
): Promise<T> {
  const directory = await mkdtemp(join(config.tempRoot ?? tmpdir(), "lore-speech-"));
  const path = join(directory, `${randomUUID()}.wav`);
  const startedAt = new Date();
  try {
    const connectionIdentity = config.originalAuthority
      ? ["-headers", `Host: ${config.originalAuthority}\r\n`]
      : [];
    const tlsIdentity = config.originalHostname
      ? ["-tls_verify", "1", "-verifyhost", config.originalHostname]
      : [];
    await runner(config.ffmpegExecutable ?? "ffmpeg", [
      "-nostdin", "-loglevel", "error", "-protocol_whitelist", "http,https,tcp,tls",
      "-max_redirects", "0", ...connectionIdentity, ...tlsIdentity, "-i", streamUrl, "-t",
      String(config.durationSeconds), "-ac", "1", "-ar", "16000", path,
    ], config.timeoutMs, undefined, config.signal);
    if (config.maxBytes != null) {
      const clip = await stat(path);
      if (clip.size > config.maxBytes) {
        throw new Error(`captured clip exceeded ${config.maxBytes} byte limit`);
      }
    }
    return await use({ path, startedAt, endedAt: new Date() });
  } finally {
    // Recursive removal also cleans partial clips left by a killed ffmpeg.
    await rm(directory, { recursive: true, force: true });
  }
}

export type LocalSttOutcome =
  | { kind: "unavailable"; reason: "not_configured" | "executable_missing" | "model_missing" }
  | { kind: "skipped"; reason: "concurrency_budget" | "cpu_budget" | "memory_budget" }
  | { kind: "silence"; intervals?: ClassifiedAudioInterval[] }
  | { kind: "music"; intervals?: ClassifiedAudioInterval[] }
  | { kind: "speech"; segments: TimestampedTranscriptSegment[]; intervals?: ClassifiedAudioInterval[] }
  | { kind: "speech_over_music"; segments: TimestampedTranscriptSegment[]; intervals?: ClassifiedAudioInterval[] }
  | { kind: "classification_failure"; reason: string }
  | { kind: "vad_failure"; reason: string }
  | { kind: "transcription_failure"; reason: string };

export type LocalSpeechClassification = "silence" | "music" | "speech" | "speech_over_music";

export interface LocalClassifierConfig {
  /** An inaSpeechSegmenter-compatible, locally installed executable. */
  executable?: string;
  modelPath?: string;
  timeoutMs: number;
  maxCpuMs?: number;
  maxMemoryBytes?: number;
}

export interface LocalVadConfig {
  /** A Silero-compatible, locally installed executable. */
  executable?: string;
  modelPath?: string;
  timeoutMs: number;
  maxCpuMs?: number;
  maxMemoryBytes?: number;
}

export interface LocalSttConfig {
  executable?: string;
  modelPath?: string;
  timeoutMs: number;
  maxConcurrency: number;
  maxCpuMs?: number;
  maxMemoryBytes?: number;
  /** When supplied, classification always completes before ASR is invoked. */
  classifier?: LocalClassifierConfig;
  /** When supplied, ASR receives only the local VAD's speech intervals. */
  vad?: LocalVadConfig;
}

interface LocalSttJson {
  outcome?: "silence" | "music" | "speech" | "speech_over_music";
  segments?: Array<{ start?: number; end?: number; text?: string }>;
}

interface LocalClassifierJson {
  outcome?: LocalSpeechClassification;
  segments?: Array<{ label?: string; start?: number; end?: number }>;
}

interface LocalVadJson {
  segments?: Array<{ start?: number; end?: number }>;
  speech_timestamps?: Array<{ start?: number; end?: number }>;
}

interface LocalVadSegment {
  start: number;
  end: number;
}

function exceedsBudget(result: LocalCommandResult, config: Pick<LocalSttConfig, "maxCpuMs" | "maxMemoryBytes">): "cpu_budget" | "memory_budget" | null {
  if (config.maxCpuMs != null && (result.cpuMs ?? 0) > config.maxCpuMs) return "cpu_budget";
  if (config.maxMemoryBytes != null && (result.maxMemoryBytes ?? 0) > config.maxMemoryBytes) return "memory_budget";
  return null;
}

/**
 * Parses both the compact JSON used by our local runner and the label segments
 * emitted by inaSpeechSegmenter wrappers. This adapter only executes a local
 * executable; it deliberately has no URL or remote-model configuration.
 */
export class LocalClassifierAdapter {
  constructor(
    private readonly config: LocalClassifierConfig,
    private readonly runner: LocalCommandRunner = runLocalCommand,
    private readonly fileAccessible: (path: string) => Promise<void> = access,
  ) {}

  async classify(clipPath: string, signal?: AbortSignal): Promise<{ kind: "classified"; classification: LocalSpeechClassification; intervals: ClassifiedAudioInterval[] } | { kind: "failure"; reason: string } | { kind: "skipped"; reason: "cpu_budget" | "memory_budget" }> {
    if (!this.config.executable) return { kind: "failure", reason: "classifier executable is not configured" };
    try {
      await this.fileAccessible(this.config.executable);
      if (this.config.modelPath) await this.fileAccessible(this.config.modelPath);
      const args = this.config.modelPath
        ? ["--model", this.config.modelPath, "--output-format", "json", clipPath]
        : ["--output-format", "json", clipPath];
       const result = await this.runner(this.config.executable, args, this.config.timeoutMs, this.config, signal);
      const budget = exceedsBudget(result, this.config);
      if (budget) return { kind: "skipped", reason: budget };
      const parsed = JSON.parse(result.stdout) as LocalClassifierJson;
      if (parsed.outcome && ["silence", "music", "speech", "speech_over_music"].includes(parsed.outcome)) {
        return { kind: "classified", classification: parsed.outcome, intervals: [] };
      }
      if (parsed.outcome) return { kind: "failure", reason: "classifier returned unknown audio class" };
      const intervals = (parsed.segments ?? []).flatMap((segment) => {
        const kind = segment.label?.toLowerCase();
        return (kind === "silence" || kind === "music" || kind === "speech" || kind === "speech_over_music") &&
          typeof segment.start === "number" && typeof segment.end === "number" && segment.end >= segment.start
          ? [{ kind, startedAtMs: Math.round(segment.start * 1000), endedAtMs: Math.round(segment.end * 1000) } as ClassifiedAudioInterval] : [];
      });
      const labels = new Set(intervals.map((segment) => segment.kind));
      const hasSpeech = labels.has("speech");
      const hasMusic = labels.has("music");
      const overlap = intervals.some((a, index) => a.kind === "speech" && intervals.some((b, other) =>
        other !== index && b.kind === "music" && a.startedAtMs < b.endedAtMs && b.startedAtMs < a.endedAtMs));
      if (overlap || labels.has("speech_over_music")) return { kind: "classified", classification: "speech_over_music", intervals };
      if (hasSpeech) return { kind: "classified", classification: "speech", intervals };
      if (hasMusic) return { kind: "classified", classification: "music", intervals };
      if (labels.has("silence")) return { kind: "classified", classification: "silence", intervals };
      return { kind: "failure", reason: "classifier returned no recognized audio class" };
    } catch (error) {
      return { kind: "failure", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Local Silero-compatible VAD adapter returning speech intervals in clip time. */
export class LocalVadAdapter {
  constructor(
    private readonly config: LocalVadConfig,
    private readonly runner: LocalCommandRunner = runLocalCommand,
    private readonly fileAccessible: (path: string) => Promise<void> = access,
  ) {}

  async trim(clipPath: string, signal?: AbortSignal): Promise<{ kind: "speech"; segments: LocalVadSegment[] } | { kind: "failure"; reason: string } | { kind: "skipped"; reason: "cpu_budget" | "memory_budget" }> {
    if (!this.config.executable) return { kind: "failure", reason: "VAD executable is not configured" };
    try {
      await this.fileAccessible(this.config.executable);
      if (this.config.modelPath) await this.fileAccessible(this.config.modelPath);
      const args = this.config.modelPath
        ? ["--model", this.config.modelPath, "--output-format", "json", clipPath]
        : ["--output-format", "json", clipPath];
       const result = await this.runner(this.config.executable, args, this.config.timeoutMs, this.config, signal);
      const budget = exceedsBudget(result, this.config);
      if (budget) return { kind: "skipped", reason: budget };
      const parsed = JSON.parse(result.stdout) as LocalVadJson;
      const segments = (parsed.segments ?? parsed.speech_timestamps ?? []).flatMap((segment) =>
        typeof segment.start === "number" && typeof segment.end === "number" && segment.end >= segment.start
          ? [{ start: segment.start, end: segment.end }] : [],
      );
      return { kind: "speech", segments };
    } catch (error) {
      return { kind: "failure", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

export interface ClassifiedAudioInterval {
  kind: LocalSpeechClassification;
  startedAtMs: number;
  endedAtMs: number;
}

export interface SpeechEndsThenMusicEvidence {
  kind: "speech_ends_then_sustained_music";
  speechEndedAtMs: number;
  musicStartedAtMs: number;
  musicDurationMs: number;
}

/**
 * Derives a presentation/ranking hint only. Consumers must keep their existing
 * station identity decision independent from this evidence.
 */
export function deriveSpeechEndsThenSustainedMusic(
  intervals: readonly ClassifiedAudioInterval[],
  minimumMusicMs = 15_000,
  maximumBoundaryGapMs = 1_000,
): SpeechEndsThenMusicEvidence | null {
  for (let index = 0; index < intervals.length - 1; index++) {
    const speech = intervals[index];
    const music = intervals[index + 1];
    if (!speech || !music || (speech.kind !== "speech" && speech.kind !== "speech_over_music") ||
      music.kind !== "music" || music.endedAtMs < music.startedAtMs ||
      music.startedAtMs - speech.endedAtMs > maximumBoundaryGapMs) continue;
    const musicDurationMs = music.endedAtMs - music.startedAtMs;
    if (musicDurationMs >= minimumMusicMs) {
      return { kind: "speech_ends_then_sustained_music", speechEndedAtMs: speech.endedAtMs, musicStartedAtMs: music.startedAtMs, musicDurationMs };
    }
  }
  return null;
}

/** Local-only STT adapter. It invokes a configured executable and never calls a network service. */
export class LocalSttAdapter {
  private active = 0;
  constructor(
    private readonly config: LocalSttConfig,
    private readonly runner: LocalCommandRunner = runLocalCommand,
    private readonly fileAccessible: (path: string) => Promise<void> = access,
  ) {}

  async availability(): Promise<Extract<LocalSttOutcome, { kind: "unavailable" }> | null> {
    if (!this.config.executable || !this.config.modelPath) return { kind: "unavailable", reason: "not_configured" };
    try { await this.fileAccessible(this.config.executable); } catch { return { kind: "unavailable", reason: "executable_missing" }; }
    try { await this.fileAccessible(this.config.modelPath); } catch { return { kind: "unavailable", reason: "model_missing" }; }
    return null;
  }

  async transcribe(clipPath: string, signal?: AbortSignal): Promise<LocalSttOutcome> {
    const unavailable = await this.availability();
    if (unavailable) return unavailable;
    if (this.active >= this.config.maxConcurrency) return { kind: "skipped", reason: "concurrency_budget" };
    this.active++;
    try {
      let classification: LocalSpeechClassification = "speech";
      let classifiedIntervals: ClassifiedAudioInterval[] | undefined;
      if (this.config.classifier) {
         const classified = await new LocalClassifierAdapter(this.config.classifier, this.runner, this.fileAccessible).classify(clipPath, signal);
        if (classified.kind === "failure") return { kind: "classification_failure", reason: classified.reason };
        if (classified.kind === "skipped") return { kind: "skipped", reason: classified.reason };
        classification = classified.classification;
        classifiedIntervals = classified.intervals;
        if (classification === "silence" || classification === "music") {
          return classified.intervals.length ? { kind: classification, intervals: classified.intervals } : { kind: classification };
        }
      }

      let trims: LocalVadSegment[] = [{ start: 0, end: 0 }];
      if (this.config.vad) {
         const trimmed = await new LocalVadAdapter(this.config.vad, this.runner, this.fileAccessible).trim(clipPath, signal);
        if (trimmed.kind === "failure") return { kind: "vad_failure", reason: trimmed.reason };
        if (trimmed.kind === "skipped") return { kind: "skipped", reason: trimmed.reason };
        if (!trimmed.segments.length) {
          return classifiedIntervals?.length
            ? { kind: "silence", intervals: classifiedIntervals }
            : { kind: "silence" };
        }
        trims = trimmed.segments;
      }
      const segments: TimestampedTranscriptSegment[] = [];
      for (const trim of trims) {
        const args = ["--model", this.config.modelPath!, "--output-format", "json"];
        if (this.config.vad) args.push("--clip-timestamps", `${trim.start},${trim.end}`);
        args.push(clipPath);
         const result = await this.runner(this.config.executable!, args, this.config.timeoutMs, this.config, signal);
        const budget = exceedsBudget(result, this.config);
        if (budget) return { kind: "skipped", reason: budget };
        const parsed = JSON.parse(result.stdout) as LocalSttJson;
        for (const segment of parsed.segments ?? []) {
          if (typeof segment.start !== "number" || typeof segment.end !== "number" ||
            segment.end < segment.start || typeof segment.text !== "string" || !segment.text.trim()) continue;
          // faster-whisper reports timestamps relative to the requested clip;
          // rebase those values to the original captured audio timeline.
          segments.push({ startedAtMs: Math.round((segment.start + trim.start) * 1000), endedAtMs: Math.round((segment.end + trim.start) * 1000), text: segment.text.trim() });
        }
      }
      return segments.length
        ? classification === "speech_over_music"
          ? classifiedIntervals?.length
            ? { kind: "speech_over_music", segments, intervals: classifiedIntervals }
            : { kind: "speech_over_music", segments }
          : classifiedIntervals?.length
            ? { kind: "speech", segments, intervals: classifiedIntervals }
            : { kind: "speech", segments }
        : classifiedIntervals?.length ? { kind: "silence", intervals: classifiedIntervals } : { kind: "silence" };
    } catch (error) {
      return { kind: "transcription_failure", reason: error instanceof Error ? error.message : String(error) };
    } finally {
      this.active--;
    }
  }
}