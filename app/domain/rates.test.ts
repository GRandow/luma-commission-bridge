import { describe, expect, it } from "vitest";
import { bpsToPercentString, parsePercentToBps } from "./rates";

describe("rates", () => {
  it("converts merchant-facing percentages to basis points exactly", () => {
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("0.33")).toBe(33);
    expect(parsePercentToBps("100")).toBe(10_000);
    expect(parsePercentToBps(null)).toBe(0);
  });

  it("rejects rates outside 0–100%", () => {
    expect(() => parsePercentToBps("120")).toThrow(RangeError);
    expect(() => parsePercentToBps("-1")).toThrow(RangeError);
    expect(() => parsePercentToBps("ten")).toThrow(TypeError);
  });

  it("prints basis points as a decimal percentage", () => {
    expect(bpsToPercentString(1000)).toBe("10.00");
    expect(bpsToPercentString(1250)).toBe("12.50");
  });
});
