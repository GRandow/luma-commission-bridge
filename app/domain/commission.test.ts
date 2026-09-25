import { describe, expect, it } from "vitest";
import { calculateCommission, formatRate } from "./commission";

describe("commission", () => {
  it("applies basis points and rounds half up", () => {
    expect(
      calculateCommission({ baseCents: 4210, rateBps: 1000 }).amountCents,
    ).toBe(421);
    expect(
      calculateCommission({ baseCents: 4215, rateBps: 1000 }).amountCents,
    ).toBe(422);
    expect(
      calculateCommission({ baseCents: 10000, rateBps: 1250 }).amountCents,
    ).toBe(1250);
    expect(
      calculateCommission({ baseCents: 1, rateBps: 1000 }).amountCents,
    ).toBe(0);
  });

  it("never pays a negative commission", () => {
    expect(
      calculateCommission({ baseCents: -500, rateBps: 1000 }).amountCents,
    ).toBe(0);
    expect(
      calculateCommission({ baseCents: 0, rateBps: 1000 }).amountCents,
    ).toBe(0);
  });

  it("refuses non-integer inputs and impossible rates", () => {
    expect(() =>
      calculateCommission({ baseCents: 10.5, rateBps: 1000 }),
    ).toThrow(TypeError);
    expect(() =>
      calculateCommission({ baseCents: 100, rateBps: 10_001 }),
    ).toThrow(RangeError);
    expect(() => calculateCommission({ baseCents: 100, rateBps: -1 })).toThrow(
      RangeError,
    );
  });

  it("formats rates", () => {
    expect(formatRate(1000)).toBe("10%");
    expect(formatRate(1250)).toBe("12.5%");
    expect(formatRate(33)).toBe("0.33%");
  });
});
