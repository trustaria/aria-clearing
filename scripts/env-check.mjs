// Lists variables named in .env.example that are empty or missing in .env.local and the shell.
// Prints names only, never values.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return values;
}

const names = Object.keys(parseEnv(resolve(root, ".env.example")));
const local = parseEnv(resolve(root, ".env.local"));
const missing = names.filter((name) => !(process.env[name] || local[name]));

if (!existsSync(resolve(root, ".env.local"))) console.log("No .env.local at the repo root.");
if (missing.length === 0) {
  console.log(`All ${names.length} variables are set.`);
} else {
  console.log(`Missing ${missing.length} of ${names.length}:`);
  for (const name of missing) console.log(`  ${name}`);
  process.exitCode = 1;
}
