import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import withSerwistInit from "@serwist/next";

// Loads the repo-root .env / .env.local (secrets) before Next reads process.env.
// Variables already set in the shell win.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production");

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist({
  transpilePackages: ["@aria-clearing/receipt"],
});
