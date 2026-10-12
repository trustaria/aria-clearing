const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LENGTH = 22;
// Bytes at or above 248 (= 4 * 62) are discarded so every character is equally likely.
const LIMIT = 248;

/** `req_` + 22 random base62 characters (~131 bits). */
export function newRequestId(): string {
  let out = "";
  while (out.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < LIMIT) out += ALPHABET[byte % 62];
      if (out.length === LENGTH) break;
    }
  }
  return `req_${out}`;
}

export function isRequestId(value: string): boolean {
  return /^req_[0-9A-Za-z]{22}$/.test(value);
}
