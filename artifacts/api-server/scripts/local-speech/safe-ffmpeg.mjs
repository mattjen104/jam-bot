#!/usr/bin/env node
/* eslint-disable no-console, no-undef -- operator-facing Node executable */
import { spawn } from "node:child_process";

const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function wait(child, name) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-32_000);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited ${code ?? signal}: ${stderr}`));
    });
  });
}

if (args.includes("-formats")) {
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
  await wait(child, "ffmpeg");
  process.exit(0);
}

const input = valueAfter("-i");
const authority = /^Host:\s*([^\r\n]+)/i.exec(valueAfter("-headers") ?? "")?.[1];
const originalHostname = valueAfter("-verifyhost");
if (!input || !authority || !originalHostname) {
  console.error("safe capture requires pinned input, Host, and verifyhost");
  process.exit(2);
}

const pinned = new URL(input);
const original = new URL(input);
original.host = authority;
const port = original.port || (original.protocol === "https:" ? "443" : "80");
const address = pinned.hostname.replace(/^\[|\]$/g, "");

const curl = spawn("curl", [
  "--fail", "--silent", "--show-error", "--max-redirs", "0",
  "--connect-timeout", "10", "--max-time", "45",
  "--resolve", `${originalHostname}:${port}:${address}`,
  original.toString(),
], { stdio: ["ignore", "pipe", "pipe"] });

const networkFlags = new Set([
  "-protocol_whitelist", "-max_redirects", "-headers",
  "-tls_verify", "-verifyhost",
]);
const decodeArgs = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (networkFlags.has(arg)) {
    index++;
    continue;
  }
  if (arg === "-i") {
    decodeArgs.push("-i", "pipe:0");
    index++;
    continue;
  }
  decodeArgs.push(arg);
}

const ffmpeg = spawn("ffmpeg", decodeArgs, { stdio: ["pipe", "pipe", "pipe"] });
curl.stdout.pipe(ffmpeg.stdin);
ffmpeg.stdout.pipe(process.stdout);

try {
  const curlDone = wait(curl, "curl").then(
    () => null,
    (error) => error,
  );
  await wait(ffmpeg, "ffmpeg");
  curl.kill("SIGTERM");
  // A broken pipe or SIGTERM is expected once FFmpeg has enough audio.
  await curlDone;
} catch (error) {
  curl.kill("SIGKILL");
  ffmpeg.kill("SIGKILL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}