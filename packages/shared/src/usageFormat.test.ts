import { describe, expect, it } from "vite-plus/test";

import { summarizeUsageCost } from "./usageFormat.ts";

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
