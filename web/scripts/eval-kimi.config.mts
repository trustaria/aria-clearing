import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Loads the repo-root .env.local, then .env, like next.config.mjs.
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: [resolve(webRoot, "..", ".env.local"), resolve(webRoot, "..", ".env")] });

export default defineConfig({
  root: webRoot,
  test: {
    include: ["scripts/eval-kimi.eval.ts"],
    environment: "node",
    testTimeout: 3 * 60 * 60 * 1000,
    disableConsoleIntercept: true,
  },
});
