#!/usr/bin/env node
// Credentials stay in a private config, never command arguments or output.
import { readFile, writeFile, stat, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

export async function privateJson(file) {
  const info = await stat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error("Private file permissions required");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error("Invalid private JSON file");
  }
}
export async function callAgent(config, method = "GET", body, mode) {
  const base = new URL(config.baseUrl);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.port && base.port !== "443") ||
    typeof config.token !== "string" ||
    config.token.length < 32
  )
    throw new Error("Invalid agent configuration");
  const url = new URL("/api/ingestion/agent/", base);
  if (mode) url.searchParams.set("mode", mode);
  let response;
  try {
    response = await fetch(url, {
      method,
      redirect: "error",
      headers: {
        authorization: "Bearer " + config.token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Agent API network failure");
  }
  const bytes = await response.text();
  if (bytes.length > 2000000) throw new Error("Agent API response too large");
  if (response.status === 404)
    throw new Error("Agent API HTTP 404 request failed");
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error("Agent API invalid response");
  }
  if (!response.ok)
    throw new Error(
      "Agent API HTTP " +
        response.status +
        " " +
        (["stale", "busy", "invalid"].includes(value.error)
          ? value.error
          : "request failed"),
    );
  return value;
}
export function watcherDecision(observation, previous = {}, now = Date.now()) {
  if (observation.missing && !previous.apiSeen)
    return { fire: false, state: { ...previous, awaitingDeployment: true } };
  if (observation.missing) observation = { error: true };
  if (observation.error) {
    const fire =
      !previous.error || now - Number(previous.lastFire ?? 0) >= 3600000;
    return {
      fire,
      state: {
        apiSeen: Boolean(previous.apiSeen),
        error: true,
        lastFire: fire ? now : previous.lastFire,
      },
    };
  }
  if (
    observation.complete !== true ||
    !Number.isInteger(observation.ready) ||
    !/^[a-f0-9]{64}$/.test(observation.revision)
  )
    throw new Error("Incomplete agent signal");
  // A successful previous run must not strand unprocessed cases. The 15m
  // rescue covers a model/runtime crash before claiming; live leases are quiet.
  const fire =
    observation.ready > 0 &&
    (previous.error ||
      previous.revision !== observation.revision ||
      now - Number(previous.lastFire ?? 0) >= 900000);
  return {
    fire,
    state: {
      apiSeen: true,
      revision: observation.revision,
      error: false,
      lastFire: fire ? now : (previous.lastFire ?? 0),
    },
  };
}
async function main() {
  const args = process.argv.slice(2),
    command = args.shift();
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (
      ![
        "--config",
        "--out",
        "--claim",
        "--decision",
        "--source",
        "--issue",
        "--state",
        "--answer",
      ].includes(flag) ||
      !args.length
    )
      throw new Error("Invalid arguments");
    options[flag.slice(2)] = args.shift();
  }
  if ((command === "list" || command === "claim") && !options.out)
    throw new Error("Private --out required for case data");
  if (options.out) {
    const parent = await stat(dirname(options.out));
    if (!parent.isDirectory() || (parent.mode & 0o077) !== 0)
      throw new Error("Private output directory required");
    try {
      await lstat(options.out);
      throw new Error("Output file already exists");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const config = await privateJson(options.config);
  let result;
  if (command === "watch") {
    const previous = options.state
      ? JSON.parse(
          options.state.startsWith("{")
            ? options.state
            : Buffer.from(options.state, "base64").toString("utf8"),
        )
      : {};
    let observation;
    try {
      observation = await callAgent(config, "GET", undefined, "signal");
      result = watcherDecision(observation, previous);
    } catch (error) {
      result = watcherDecision(
        error.message.includes("HTTP 404")
          ? { missing: true }
          : { error: true },
        previous,
      );
    }
  } else if (command === "signal")
    result = await callAgent(config, "GET", undefined, "signal");
  else if (command === "list") result = await callAgent(config);
  else if (command === "claim")
    result = await callAgent(config, "POST", {
      operation: "claim",
      sourceId: options.source,
      issueId: options.issue,
    });
  else if (command === "resume")
    result = await callAgent(config, "POST", {
      operation: "resume",
      sourceId: options.source,
      issueId: options.issue,
      answer: (await privateJson(options.answer)).answer,
    });
  else if (command === "resolve" || command === "release") {
    const claim = await privateJson(options.claim);
    const payload = {
      operation: command,
      issueId: claim.issueId,
      leaseToken: claim.leaseToken,
    };
    if (command === "resolve")
      Object.assign(payload, {
        sourceId: claim.sourceId,
        snapshot: claim.snapshot,
        decision: await privateJson(options.decision),
      });
    result = await callAgent(config, "POST", payload);
  } else throw new Error("Unknown command");
  if (options.out) {
    await writeFile(options.out, JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        saved: true,
        ...(command === "claim" ? { claimed: true } : {}),
      }),
    );
  } else if (command === "list" || command === "claim")
    throw new Error("Private --out required for case data");
  else console.log(JSON.stringify(result));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
