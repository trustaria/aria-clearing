import { describe, expect, it } from "vitest";
import {
  addressUrl,
  formatDollars,
  formatMon,
  formatPercent,
  formatShare,
  formatUsdc,
  publisherKey,
  shortAddress,
  shortHash,
  timeAgo,
  txUrl,
} from "../lib/format";

describe("formatDollars", () => {
  it("shows USDC base units as dollars", () => {
    expect(formatDollars(0n)).toBe("$0.00");
    expect(formatDollars(260_000n)).toBe("$0.26");
    expect(formatDollars(250_000n)).toBe("$0.25");
    expect(formatDollars(12_345_000_000n)).toBe("$12,345.00");
  });
});

describe("formatPercent", () => {
  it("keeps one decimal and shows a dash with nothing to divide", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1 / 3)).toBe("33.3%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("publisherKey", () => {
  it("masks the address down to its last four characters", () => {
    expect(publisherKey("0x67435bD1FCd81D6c25C6546a86af0eF6887F72cb")).toBe("pk_live_••••72cb");
  });
});

describe("timeAgo", () => {
  it("rounds down to the largest whole unit", () => {
    expect(timeAgo(1_000, 1_030)).toBe("just now");
    expect(timeAgo(1_000, 1_000 + 5 * 60 + 59)).toBe("5 min ago");
    expect(timeAgo(1_000, 1_000 + 3 * 3600)).toBe("3 h ago");
    expect(timeAgo(1_000, 1_000 + 2 * 86400)).toBe("2 d ago");
    expect(timeAgo(2_000, 1_000)).toBe("just now");
  });
});

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

describe("formatShare", () => {
  it("shows basis points as a percentage with a space before the sign", () => {
    expect(formatShare(2000)).toBe("20 %");
    expect(formatShare(8000)).toBe("80 %");
    expect(formatShare(2050)).toBe("20.5 %");
    expect(formatShare(1234)).toBe("12.34 %");
  });
});
