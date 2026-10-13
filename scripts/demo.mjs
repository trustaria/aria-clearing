// Demo helpers: `reset` archives the local event log for a clean take; `warm` compiles every page before recording.
// The publisher login and console campaigns are kept, and nothing onchain changes.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "web", ".data");
const base = process.env.DEMO_URL || "http://localhost:3000";

const PAGES = [
  "/",
  "/?debug=1",
  "/dashboard",
  "/advertise",
  "/advertise/new",
  "/receipt/req_36wX7fR79VnTOVHwllgYhA",
  "/api/aria/events",
];

function reset() {
  const events = join(data, "events.json");
  if (!existsSync(events)) {
    console.log("No local event log to archive.");
    return;
  }
  const archive = join(data, "archive");
  mkdirSync(archive, { recursive: true });
  const target = join(archive, `events-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  renameSync(events, target);
  console.log(`Archived the event log to ${target}. Publisher login and console campaigns are kept.`);
  console.log("Restart the app (pnpm dev) so its in-memory event store starts empty.");
}

async function warm() {
  for (const path of PAGES) {
    const started = Date.now();
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(120_000) });
      console.log(`${res.status}  ${((Date.now() - started) / 1000).toFixed(1)} s  ${path}`);
    } catch (err) {
      console.log(`fail  ${path}  ${err.message}`);
    }
  }
}

const command = process.argv[2];
if (command === "reset") reset();
else if (command === "warm") await warm();
else {
  console.error("usage: node scripts/demo.mjs reset|warm");
  process.exit(2);
}
