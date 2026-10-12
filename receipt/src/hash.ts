import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

export enum Kind {
  Impression = 0,
  Click = 1,
}

/** Approved claims as one string: numbered lines, no trailing newline. */
export function formatClaims(claims: string[]): string {
  return claims.map((claim, i) => `${i + 1}. ${claim}`).join("\n");
}

/** The exact string a card renders and the contract emits. */
export function normalizeRationale(rationale: string): string {
  return rationale.trim().normalize("NFC");
}

export function claimsHash(claims: string): Hex {
  return keccak256(toBytes(claims));
}

export function rationaleHash(rationale: string): Hex {
  return keccak256(toBytes(normalizeRationale(rationale)));
}

export function requestKeyOf(requestId: string): Hex {
  return keccak256(toBytes(requestId));
}

export function eventIdOf(requestId: string, kind: Kind): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint8" }], [requestId, kind]));
}

export function campaignIdOf(slug: string): Hex {
  return keccak256(toBytes(slug));
}
