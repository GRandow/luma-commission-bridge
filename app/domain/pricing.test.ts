import { describe, expect, it } from "vitest";
import {
  buildPricingConfig,
  DEFAULT_PRICING_SETTINGS,
  distinctLevels,
  formatPercent,
  levelKey,
  parsePercentInput,
  referralPercentFor,
  settingsFromConfig,
  settingsFromForm,
  wholesalePercentFor,
} from "./pricing";

const ana = {
  id: "gid://shopify/Metaobject/1",
  code: "ANA123",
  name: "Ana Souza",
  level: "Consultant",
  active: true,
};
const carla = {
  id: "gid://shopify/Metaobject/3",
  code: "LEAD001",
  name: "Carla Mendes",
  level: "Team  Leader",
  active: true,
};
const old = {
  id: "gid://shopify/Metaobject/9",
  code: "OLD999",
  name: "Former Distributor",
  level: null,
  active: false,
};

describe("levels", () => {
  it("matches levels however they were typed", () => {
    expect(levelKey("  Team   LEADER ")).toBe("team leader");
  });

  it("lists each level once, in its first spelling, without blanks", () => {
    expect(
      distinctLevels([
        ana,
        carla,
        old,
        { level: "consultant" },
        { level: "  " },
      ]),
    ).toEqual(["Consultant", "Team  Leader"]);
  });

  it("uses a level's own rate, else the default", () => {
    const settings = {
      ...DEFAULT_PRICING_SETTINGS,
      levelPercents: { "team leader": 30 },
    };
    expect(wholesalePercentFor(settings, "Team Leader")).toBe(30);
    expect(wholesalePercentFor(settings, "Consultant")).toBe(20);
    expect(wholesalePercentFor(settings, null)).toBe(20);
  });
});

describe("buildPricingConfig", () => {
  it("carries the settings and only the active distributors", () => {
    const config = buildPricingConfig(DEFAULT_PRICING_SETTINGS, [
      ana,
      carla,
      old,
    ]);
    expect(config).toEqual({
      version: 1,
      referralPercent: 10,
      referralPercents: {},
      wholesalePercent: 20,
      levelPercents: {},
      distributors: [
        {
          id: ana.id,
          code: "ANA123",
          name: "Ana Souza",
          level: "Consultant",
        },
        {
          id: carla.id,
          code: "LEAD001",
          name: "Carla Mendes",
          level: "Team  Leader",
        },
      ],
    });
  });
});

describe("settings", () => {
  it("round-trips through a stored config", () => {
    const settings = {
      referralPercent: 12.5,
      referralPercents: { [ana.id]: 15 },
      wholesalePercent: 25,
      levelPercents: { consultant: 22 },
    };
    const stored = JSON.parse(
      JSON.stringify(buildPricingConfig(settings, [ana])),
    );
    expect(settingsFromConfig(stored)).toEqual(settings);
  });

  it("falls back to the defaults for anything malformed", () => {
    expect(settingsFromConfig(null)).toEqual(DEFAULT_PRICING_SETTINGS);
    expect(
      settingsFromConfig({
        referralPercent: "ten",
        wholesalePercent: 140,
        levelPercents: { gold: -5, silver: 15 },
      }),
    ).toEqual({
      referralPercent: 10,
      referralPercents: {},
      wholesalePercent: 20,
      levelPercents: { silver: 15 },
    });
  });

  it("reads form percentages", () => {
    expect(parsePercentInput("12.5")).toBe(12.5);
    expect(parsePercentInput(" 20% ")).toBe(20);
    expect(parsePercentInput("")).toBeNull();
    expect(parsePercentInput(null)).toBeNull();
    expect(() => parsePercentInput("120")).toThrow(RangeError);
    expect(() => parsePercentInput("abc")).toThrow(/not a percentage/);
  });

  it("formats percentages without trailing zeros", () => {
    expect(formatPercent(20)).toBe("20%");
    expect(formatPercent(12.5)).toBe("12.5%");
  });
});

describe("settingsFromForm", () => {
  it("reads the percentages and keys level rates by level", () => {
    expect(
      settingsFromForm({
        referralPercent: "10",
        referralPercents: { [ana.id]: "15", [carla.id]: "" },
        wholesalePercent: "20",
        levelPercents: { "Team Leader": "30", Consultant: "" },
      }),
    ).toEqual({
      referralPercent: 10,
      referralPercents: { [ana.id]: 15 },
      wholesalePercent: 20,
      levelPercents: { "team leader": 30 },
    });
  });

  it("requires the two main percentages and names the bad level", () => {
    expect(() =>
      settingsFromForm({
        referralPercent: "",
        referralPercents: {},
        wholesalePercent: "20",
        levelPercents: {},
      }),
    ).toThrow(/referral/);
    expect(() =>
      settingsFromForm({
        referralPercent: "10",
        referralPercents: {},
        wholesalePercent: "20",
        levelPercents: { Gold: "150" },
      }),
    ).toThrow(/^Gold: /);
    expect(() =>
      settingsFromForm(
        {
          referralPercent: "10",
          referralPercents: { [ana.id]: "abc" },
          wholesalePercent: "20",
          levelPercents: {},
        },
        { [ana.id]: "Ana Souza" },
      ),
    ).toThrow(/^Ana Souza: /);
  });
});

describe("per-distributor referral rates", () => {
  it("uses a distributor's own rate, else the default", () => {
    const settings = {
      ...DEFAULT_PRICING_SETTINGS,
      referralPercents: { [ana.id]: 15 },
    };
    expect(referralPercentFor(settings, ana.id)).toBe(15);
    expect(referralPercentFor(settings, carla.id)).toBe(10);
  });

  it("keeps rates of inactive distributors and drops those of deleted ones", () => {
    const config = buildPricingConfig(
      {
        ...DEFAULT_PRICING_SETTINGS,
        referralPercents: { [old.id]: 5, "gid://shopify/Metaobject/404": 50 },
      },
      [ana, old],
    );
    expect(config.referralPercents).toEqual({ [old.id]: 5 });
  });
});
