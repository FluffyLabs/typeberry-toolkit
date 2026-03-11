#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

function printUsage() {
  console.error(
    "Usage: node scripts/upload-artifact.mjs --file <path> --worker <base-url> [--ttl <seconds>] [--debugger <base-url>] [--open]",
  );
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key.startsWith("--")) {
      continue;
    }

    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = "true";
      continue;
    }

    args[key.slice(2)] = value;
    index += 1;
  }

  return args;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function shouldOpenBrowser(value) {
  return value === "true" || value === "1" || value === "yes";
}

function openInBrowser(url) {
  const launchCommands =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [["xdg-open", [url]]];

  for (const [command, args] of launchCommands) {
    const result = spawnSync(command, args, { stdio: "ignore" });
    if (!result.error && result.status === 0) {
      return;
    }
  }

  throw new Error("Could not open browser automatically on this platform.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file;
  const workerBase = args.worker;
  const ttl = args.ttl;
  const debuggerBase = args.debugger;
  const open = shouldOpenBrowser(args.open);

  if (!filePath || !workerBase) {
    printUsage();
    process.exit(1);
  }

  if (open && !debuggerBase) {
    console.error("--open requires --debugger <base-url>.");
    process.exit(1);
  }

  const file = await readFile(filePath);
  const endpoint = new URL(`${normalizeBaseUrl(workerBase)}/artifacts`);

  if (ttl) {
    endpoint.searchParams.set("ttl", ttl);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-upload-file-name": basename(filePath),
    },
    body: file,
  });

  const textPayload = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(textPayload);
  } catch {
    parsed = { raw: textPayload };
  }

  if (!response.ok) {
    console.error("Upload failed", {
      status: response.status,
      body: parsed,
    });
    process.exit(1);
  }

  console.log(JSON.stringify(parsed, null, 2));

  if (debuggerBase && parsed.artifactId) {
    const debuggerUrl = `${normalizeBaseUrl(debuggerBase)}/#/load?artifact=${encodeURIComponent(parsed.artifactId)}`;
    console.log(`Debugger link: ${debuggerUrl}`);

    if (open) {
      openInBrowser(debuggerUrl);
      console.log("Opened debugger in your default browser.");
    }
  }
}

main().catch((error) => {
  console.error("Unexpected error", error);
  process.exit(1);
});
