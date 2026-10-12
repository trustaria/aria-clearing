import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import withSerwistInit from "@serwist/next";

// Loads the repo-root .env.local, then .env, into process.env before Next reads it.
// Variables already set (shell, web/.env*) win.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: [resolve(repoRoot, ".env.local"), resolve(repoRoot, ".env")] });

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist({
  transpilePackages: ["@aria-clearing/receipt", "@aria-clearing/ops"],
});
