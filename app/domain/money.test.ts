import { describe, expect, it } from "vitest";
import { centsToMoneyString, formatCents, parseMoneyToCents } from "./money";

describe("money", () => {
  it("parses Shopify money strings into cents without floating point drift", () => {
    expect(parseMoneyToCents("42.10")).toBe(4210);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("19.999")).toBe(1999);
    expect(parseMoneyToCents("1234")).toBe(123400);
    expect(parseMoneyToCents("-5.05")).toBe(-505);
    expect(parseMoneyToCents(null)).toBe(0);
    expect(parseMoneyToCents("")).toBe(0);
  });

  it("rejects values that are not money", () => {
    expect(() => parseMoneyToCents("R$ 10")).toThrow(TypeError);
    expect(() => parseMoneyToCents("1,000.00")).toThrow(TypeError);
  });

  it("prints cents back as Shopify money strings", () => {
    expect(centsToMoneyString(4210)).toBe("42.10");
    expect(centsToMoneyString(5)).toBe("0.05");
    expect(centsToMoneyString(-505)).toBe("-5.05");
  });

  it("formats for humans", () => {
    expect(formatCents(4210, "USD")).toBe("$42.10");
    expect(formatCents(4210, "BRL", "pt-BR")).toMatch(/42,10/);
  });
});
