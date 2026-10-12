// Rewrites the AriaClearing address and start_block in config.yaml from deployments/10143.json.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const deploymentPath = fileURLToPath(new URL("../../deployments/10143.json", import.meta.url));
const configPath = fileURLToPath(new URL("../config.yaml", import.meta.url));

const { address, deployBlock } = JSON.parse(readFileSync(deploymentPath, "utf8"));
if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !Number.isInteger(deployBlock)) {
  throw new Error(`deployments/10143.json needs address and deployBlock, got ${address} / ${deployBlock}`);
}

const before = readFileSync(configPath, "utf8");
const after = before
  .replace(/^(\s*start_block:\s*)\d+/m, `$1${deployBlock}`)
  .replace(/^(\s*address:\s*)"0x[0-9a-fA-F]{40}"/m, `$1"${address}"`);

if (after === before) {
  console.log(`config.yaml already at ${address} from block ${deployBlock}`);
} else {
  writeFileSync(configPath, after);
  console.log(`config.yaml now indexes ${address} from block ${deployBlock}`);
}
