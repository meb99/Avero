import { describe, expect, it } from "vitest";
import { CHIPS, chipFor } from "./chips";

describe("chips", () => {
  it("are found from the device names in board files", () => {
    // As GenCAD files name them (Lenovo LA-G132P).
    expect(chipFor("ISL88739AHRZ-T_QFN32_4X4")?.name).toBe("ISL88739A");
    expect(chipFor("RT6575DGQW-2_WQFN20_3X3")?.name).toBe("RT6575C/D");
    expect(chipFor("NCP303151MNTWG_PQFN41_5X6")?.name).toBe("NCP303151");
    expect(chipFor("SY8288RAC_QFN20_3X3")?.name).toBe("SY8284 / SY8288");
    expect(chipFor("KB9542Q-B_LQFP128_14X14")?.name).toBe("KB9542");
    expect(chipFor("M92T36")?.name).toBe("M92T36");
    expect(chipFor("NB7N621M")?.name).toBe("NB7NQ621M");
    expect(chipFor("C-0402 100nF")).toBeUndefined();
    expect(chipFor(undefined)).toBeUndefined();
  });

  it("each name a source and match their own name", () => {
    for (const c of CHIPS) {
      expect(c.url).toMatch(/^https:\/\//);
      expect(chipFor(c.name.split(" ")[0].replace("/", "")), c.name).toBe(c);
    }
  });
});
