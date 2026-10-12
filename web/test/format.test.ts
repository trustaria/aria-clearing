import { describe, expect, it } from "vitest";
import { addressUrl, formatMon, formatUsdc, shortAddress, shortHash, txUrl } from "../lib/format";

describe("formatUsdc", () => {
  it("reads 6 decimals and keeps at least two", () => {
    expect(formatUsdc(0n)).toBe("0.00");
    expect(formatUsdc(10_000n)).toBe("0.01");
    expect(formatUsdc(1_000_000n)).toBe("1.00");
    expect(formatUsdc(1_234_567n)).toBe("1.234567");
    expect(formatUsdc(1_500_000n)).toBe("1.50");
    expect(formatUsdc(12_345_000_000n)).toBe("12,345.00");
  });
});

describe("formatMon", () => {
  it("shows up to four decimals", () => {
    expect(formatMon(0n)).toBe("0");
    expect(formatMon(10n ** 18n)).toBe("1");
    expect(formatMon(1_234_567_890_000_000_000n)).toBe("1.2345");
    expect(formatMon(100_000_000_000_000n)).toBe("0.0001");
  });

  it("does not round a dust balance down to zero", () => {
    expect(formatMon(1n)).toBe("<0.0001");
  });
});

describe("shortAddress", () => {
  it("keeps the 0x prefix, four leading and four trailing characters", () => {
    expect(shortAddress("0xD2D508841C0C99D31C78C03C94338D88Ca19416b")).toBe("0xD2D5…416b");
  });

  it("shortens a 32-byte hash with six on each side", () => {
    expect(shortHash("0x1f3c80aac2c5ca10bee92a4e59bda897454002d643517bcdc978eb3d01a4ff61")).toBe("0x1f3c80…a4ff61");
  });
});

describe("explorer links", () => {
  it("points at MonadVision", () => {
    expect(txUrl("0xabc")).toBe("https://testnet.monadvision.com/tx/0xabc");
    expect(addressUrl("0xdef")).toBe("https://testnet.monadvision.com/address/0xdef");
  });
});
