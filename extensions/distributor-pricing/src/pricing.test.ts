import { describe, expect, it } from "vitest";
import { chooseDeal, readConfig, type PricingConfig } from "./pricing";

const ANA = "gid://shopify/Metaobject/1";
const CARLA = "gid://shopify/Metaobject/3";

const config: PricingConfig = {
  referralPercent: 10,
  referralPercents: { [CARLA]: 15 },
  wholesalePercent: 20,
  levelPercents: { "team leader": 30, consultant: 5 },
  distributors: [
    { id: ANA, code: "ANA123", name: "Ana Souza", level: "Consultant" },
    { id: CARLA, code: "LEAD001", name: "Carla Mendes", level: "Team leader" },
    {
      id: "gid://shopify/Metaobject/4",
      code: "NOLVL1",
      name: "No Level",
      level: null,
    },
  ],
};

describe("readConfig", () => {
  it("accepts the app's config and normalises codes and levels", () => {
    expect(
      readConfig({
        version: 1,
        referralPercent: 10,
        wholesalePercent: 20,
        levelPercents: { " Team  Leader ": 30 },
        distributors: [
          { id: ANA, code: " ana123 ", name: "Ana Souza", level: "" },
        ],
      }),
    ).toEqual({
      referralPercent: 10,
      referralPercents: {},
      wholesalePercent: 20,
      levelPercents: { "team leader": 30 },
      distributors: [
        { id: ANA, code: "ANA123", name: "Ana Souza", level: null },
      ],
    });
  });

  it("refuses a missing or broken config instead of guessing", () => {
    expect(readConfig(null)).toBeNull();
    expect(readConfig("{}")).toBeNull();
    expect(readConfig({ referralPercent: 10 })).toBeNull();
    expect(
      readConfig({ referralPercent: 10, wholesalePercent: 120 }),
    ).toBeNull();
  });

  it("skips distributors it cannot use", () => {
    const read = readConfig({
      referralPercent: 10,
      wholesalePercent: 20,
      distributors: [
        null,
        { id: ANA, code: "no spaces allowed", name: "Ana" },
        { id: "", code: "ANA123", name: "Ana" },
        { id: CARLA, code: "LEAD001", name: "Carla Mendes" },
      ],
    });
    expect(read?.distributors.map((distributor) => distributor.code)).toEqual([
      "LEAD001",
    ]);
  });
});

describe("chooseDeal", () => {
  it("gives a referred shopper the referral discount", () => {
    expect(chooseDeal(config, "ana123", null)).toEqual({
      kind: "referral",
      percent: 10,
      message: "Referred by Ana Souza: 10% off",
    });
  });

  it("ignores unknown codes, and codes of distributors no longer active", () => {
    expect(chooseDeal(config, "XYZ999", null)).toBeNull();
    expect(chooseDeal(config, "", null)).toBeNull();
  });

  it("prices a linked customer at their level's wholesale", () => {
    expect(chooseDeal(config, null, CARLA)).toEqual({
      kind: "wholesale",
      percent: 30,
      message: "Distributor price (Team leader): 30% off",
    });
  });

  it("falls back to the default wholesale for a level without its own rate", () => {
    expect(
      chooseDeal(config, null, "gid://shopify/Metaobject/4"),
    ).toMatchObject({
      percent: 20,
      message: "Distributor price: 20% off",
    });
  });

  it("keeps the larger discount when both apply", () => {
    // Carla (30% wholesale) shopping through Ana's link keeps her wholesale…
    expect(chooseDeal(config, "ANA123", CARLA)).toMatchObject({
      kind: "wholesale",
      percent: 30,
    });
    // …while Ana (5% as a consultant) through Carla's link gets Carla's 15% referral.
    expect(chooseDeal(config, "LEAD001", ANA)).toMatchObject({
      kind: "referral",
      percent: 15,
      message: "Referred by Carla Mendes: 15% off",
    });
  });

  it("does not give a distributor the referral discount through their own code", () => {
    expect(chooseDeal(config, "ANA123", ANA)).toMatchObject({
      kind: "wholesale",
      percent: 5,
    });
  });

  it("applies nothing for a customer who is not a distributor", () => {
    expect(chooseDeal(config, null, "gid://shopify/Metaobject/999")).toBeNull();
    expect(chooseDeal(config, null, null)).toBeNull();
  });

  it("treats a 0% rate as no discount", () => {
    expect(
      chooseDeal({ ...config, referralPercent: 0 }, "ANA123", null),
    ).toBeNull();
  });

  it("uses the referring distributor's own rate, else the default", () => {
    expect(chooseDeal(config, "LEAD001", null)).toMatchObject({
      percent: 15,
      message: "Referred by Carla Mendes: 15% off",
    });
    expect(chooseDeal(config, "ANA123", null)).toMatchObject({ percent: 10 });
    expect(
      chooseDeal(
        { ...config, referralPercents: { [CARLA]: 0 } },
        "LEAD001",
        null,
      ),
    ).toBeNull();
  });

  it("reads per-distributor referral rates, skipping bad ones", () => {
    expect(
      readConfig({
        referralPercent: 10,
        wholesalePercent: 20,
        referralPercents: { [ANA]: 12.5, [CARLA]: 400 },
      })?.referralPercents,
    ).toEqual({ [ANA]: 12.5 });
  });
});
