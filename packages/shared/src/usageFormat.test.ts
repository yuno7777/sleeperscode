import { describe, expect, it } from "vite-plus/test";

import { formatObservedUsageCost, summarizeUsageCost } from "./usageFormat.ts";

describe("summarizeUsageCost", () => {
  it("does not present partial pricing as a complete total", () => {
    expect(summarizeUsageCost(0)).toEqual({
      label: "Raw token cost",
      detail: "* if billed at full API rate",
    });
    expect(summarizeUsageCost(0.2)).toEqual({
      label: "Priced token cost",
      detail: "Excludes observed usage without a trustworthy price.",
    });
  });
});

describe("formatObservedUsageCost", () => {
  it("does not render unpriced observed tokens as free usage", () => {
    expect(
      formatObservedUsageCost({
        costUsd: 0,
        totalTokens: 25_200,
        hasPricedUsage: false,
        hasUnpricedUsage: true,
      }),
    ).toBe("N/A");
  });

  it("marks mixed price coverage without hiding the priced amount", () => {
    expect(
      formatObservedUsageCost({
        costUsd: 12.5,
        totalTokens: 25_200,
        hasPricedUsage: true,
        hasUnpricedUsage: true,
      }),
    ).toBe("$12.50*");
  });
});
