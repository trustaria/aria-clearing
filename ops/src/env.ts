import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

type Env = Record<string, string | undefined>;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Path of the env file the scripts read and append to; ARIA_ENV_FILE overrides the repo root .env.local. */
export function envFilePath(): string {
  return process.env.ARIA_ENV_FILE ?? join(repoRoot, ".env.local");
}

/** Names from `names` that are unset or empty in `env`. */
export function missingEnv(names: readonly string[], env: Env = process.env): string[] {
  return names.filter((name) => !env[name]);
}

/** Returns the requested values; throws listing only the missing names, never values. */
export function requireEnv<const N extends string>(
  names: readonly N[],
  env: Env = process.env,
): Record<N, string> {
  const missing = missingEnv(names, env);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(", ")}`);
  return Object.fromEntries(names.map((name) => [name, env[name] as string])) as Record<N, string>;
}

/** Loads the env file into process.env without overriding variables already set. */
export function loadEnvFile(path: string = envFilePath()): void {
  if (!existsSync(path)) throw new Error(`Env file not found: ${path}`);
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Formats `KEY=value` lines; prefixes a newline when the existing content does not end with one. */
export function envLines(entries: Record<string, string>, existing: string): string {
  const body = Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  return existing.length > 0 && !existing.endsWith("\n") ? `\n${body}` : body;
}

/** Appends entries to the env file and to process.env. */
export function appendEnv(entries: Record<string, string>, path: string = envFilePath()): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  appendFileSync(path, envLines(entries, existing));
  Object.assign(process.env, entries);
}
