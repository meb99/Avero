// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { netReadings, obdValue, obdText, parseObdata, partValues } from "./obdata";
import { EMPTY_KNOWLEDGE, mergeKnowledge, obdataFor, parseKnowledgeFile, toKnowledge } from "./store";
import { textPieces } from "./wikitext";

// The shape of a file from openboarddata.org (CRLF line ends as downloaded).
const SAMPLE = [
  "HEADER_DATA_START",
  "OBDATA_V002 https://openboarddata.org",
  "BOARDPATH laptops/apple/820-00165",
  "ID 820-00165",
  "BRAND apple",
  "CATEGORY laptops",
  "HEADER_DATA_END",
  "### Released under the OBbL - https://opendatacommons.org/licenses/odbl/1-0/",
  "DIAGNOSIS_DATA_START",
  "SECT_START Backlight",
  "NOTE_START Diagnosing",
  "If 8.4V check EN signal on [p:U7701:3], if present, check [n:BKL_PWM]",
  "",
  "NOTE_END",
  "SECT_END",
  "SECT_START New Section",
  "NOTE_START New Title",
  "Testing",
  "NOTE_END",
  "SECT_END",
  "DIAGNOSIS_DATA_END",
  "COMPONENTS_DATA_START",
  "### Component Category Value Comment",
  "C1000 p 0402",
  "C1000 v 10UF",
  "COMPONENTS_DATA_END",
  "NETS_DATA_START",
  "### Network Valuetype Value Comment",
  "PP3V42_G3H/Default d 0.320 ''",
  "PP3V42_G3H/Default v 3.4 ''",
  "PP3V42_G3H/Default t If+voltage+below+3.35+check+U7090.%0AAlso+check+for+short. ''",
  "PP3V42_G3H/TP%2Band%2BKB%2BInstalled d 0.300 ''",
  "CPUVR_PHASE1/1.6GHz+4GB r 15.00r '+'",
  "PP5V_S5/Default a PP5V_S4RS3 ''",
  "PP5V_S5/Default d 0.43 ''",
  "PP5V_S5/Default r na ''",
  "PP5V_S4RS3/Default v 5.000 ''",
  "PPBUS_S5_HS_COMPUTING_ISNS/Default t - ''",
  "ALL_SYS_PWRGD_R/Default d ol ''",
  "NETS_DATA_END",
  "### END",
].join("\r\n");

describe("OpenBoardData", () => {
  const { data, blocks } = parseObdata(SAMPLE);

  it("reads the header, components and values", () => {
    expect([data.id, data.path, data.brand, data.category]).toEqual(["820-00165", "laptops/apple/820-00165", "apple", "laptops"]);
    expect(partValues(data, "c1000")).toEqual([
      { part: "C1000", kind: "p", value: "0402" },
      { part: "C1000", kind: "v", value: "10UF" },
    ]);
  });

  it("gives the values of a net per condition, with its notes", () => {
    expect(netReadings(data, "pp3v42_g3h")).toEqual({
      rows: [
        { condition: "Default", d: "0.320", v: "3.4 V", r: "", notes: ["If voltage below 3.35 check U7090.\nAlso check for short."] },
        // Encoded twice in the file: "TP%2Band%2BKB" means "TP and KB".
        { condition: "TP and KB Installed", d: "0.300", v: "", r: "", notes: [] },
      ],
      related: [],
    });
    expect(netReadings(data, "CPUVR_PHASE1").rows[0]).toMatchObject({ condition: "1.6GHz 4GB", r: "15.00 Ω" });
    expect(netReadings(data, "ALL_SYS_PWRGD_R").rows[0].d).toBe("OL");
    // A note that says nothing is no note.
    expect(netReadings(data, "PPBUS_S5_HS_COMPUTING_ISNS").rows).toEqual([]);
  });

  it("keeps related nets apart, each with its own values", () => {
    const s5 = netReadings(data, "PP5V_S5");
    expect(s5.rows[0]).toMatchObject({ d: "0.43", r: "n/a", v: "" });
    expect(s5.related).toEqual(["PP5V_S4RS3"]);
    expect(netReadings(data, "PP5V_S4RS3")).toEqual({
      rows: [{ condition: "Default", d: "", v: "5.000 V", r: "", notes: [] }],
      related: ["PP5V_S5"],
    });
  });

  it("writes units only where the file names them", () => {
    expect(obdValue("r", "2.80k")).toBe("2.80 kΩ");
    expect(obdValue("r", "1.00M")).toBe("1.00 MΩ");
    expect(obdValue("r", "0.300R")).toBe("0.300 Ω");
    expect(obdValue("r", "201")).toBe("201");
    expect(obdValue("v", "3.3")).toBe("3.3 V");
  });

  it("links nets and pins in the diagnosis notes and drops empty template sections", () => {
    expect(blocks.map((b) => (b.type === "heading" ? b.text : b.type))).toEqual(["Backlight", "Diagnosing", "list"]);
    const item = blocks[2].type === "list" ? blocks[2].items[0] : "";
    expect(textPieces(item).filter((x) => "target" in x)).toEqual([
      { text: "U7701.3", target: "part:U7701:3" },
      { text: "BKL_PWM", target: "net:BKL_PWM" },
    ]);
    expect(textPieces(obdText("[p:U7400]"))).toEqual([{ text: "U7400", target: "part:U7400" }]);
  });

  it("becomes a knowledge page that is used only for its own board", () => {
    const [page] = parseKnowledgeFile(SAMPLE, "820-00165.obdata");
    const k = toKnowledge(page);
    expect(k.source).toBe("openboarddata.org");
    expect(k.license).toBe("ODbL 1.0");
    expect(k.url).toBe("https://openboarddata.org/?a=showboardsolutions&bpath=laptops/apple/820-00165");
    const base = mergeKnowledge(EMPTY_KNOWLEDGE, [k]);
    expect(obdataFor(base, ["820-00165", "a1466"])?.title).toBe("OpenBoardData 820-00165");
    expect(obdataFor(base, ["820-00164"])).toBeUndefined();
    // Chosen by hand: used even without a matching file name, and only that one.
    expect(obdataFor(base, [], "820-00165")?.obdata?.id).toBe("820-00165");
    expect(obdataFor(base, ["820-00165"], "820-99999")).toBeUndefined();
  });

  it("rejects files without a board", () => {
    expect(() => parseObdata("HEADER_DATA_START\nHEADER_DATA_END")).toThrow();
  });
});
