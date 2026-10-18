import { describe, it, expect } from "vitest";
import { repairJson } from "../src/lib/jsonRepair";

describe("repairJson", () => {
  it("parses clean JSON as-is", () => {
    expect(repairJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(repairJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(repairJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("extracts JSON surrounded by prose", () => {
    expect(repairJson('Sure! Here is the JSON you asked for:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it("removes trailing commas", () => {
    expect(repairJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it("finds the outermost balanced object", () => {
    expect(repairJson('noise {"outer":{"inner":2},} more')).toEqual({ outer: { inner: 2 } });
  });

  it("does not confuse braces inside strings", () => {
    expect(repairJson('{"text":"a } brace and a { one"}')).toEqual({ text: "a } brace and a { one" });
  });

  it("handles escaped quotes in strings", () => {
    expect(repairJson('{"text":"say \\"hi\\" {"}')).toEqual({ text: 'say "hi" {' });
  });

  it("returns null for unfixable garbage", () => {
    expect(repairJson("I cannot answer that.")).toBeNull();
    expect(repairJson("")).toBeNull();
    expect(repairJson('{"broken":')).toBeNull();
  });

  it("does not crash on nested structures", () => {
    expect(repairJson('{"a":{"b":[1,{"c":2},],},}')).toEqual({ a: { b: [1, { c: 2 }] } });
  });
});
