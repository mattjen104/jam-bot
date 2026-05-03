import { config } from "./config.js";

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

function ts() {
  return new Date().toISOString();
}

function log(level: Level, msg: string, meta?: unknown) {
  if (levels[level] < levels[config.LOG_LEVEL]) return;
  const line = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  if (meta !== undefined) {
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${line} ${JSON.stringify(meta)}\n`);
  } else {
    const stream = level === "error" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log("debug", msg, meta),
  info: (msg: string, meta?: unknown) => log("info", msg, meta),
  warn: (msg: string, meta?: unknown) => log("warn", msg, meta),
  error: (msg: string, meta?: unknown) => log("error", msg, meta),
};
