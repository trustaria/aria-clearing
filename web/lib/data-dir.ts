import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Path of a JSON store file: `override` when set, else `name` under ARIA_DATA_DIR,
 * else under `.data` in the working directory. Creates ARIA_DATA_DIR when it is missing.
 */
export function dataFile(name: string, override?: string): string {
  if (override) return override;
  const dir = process.env.ARIA_DATA_DIR;
  if (!dir) return join(process.cwd(), ".data", name);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}
