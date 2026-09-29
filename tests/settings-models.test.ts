/**
 * Settings model-picker tests: buildModelOptions() in src/web/app/ui-utils.js.
 * Pure option/selection logic for the provider/model dropdown — the DOM
 * wiring in app.js paintModels() just renders what this returns.
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { buildModelOptions } = uiUtils;

describe("buildModelOptions", () => {
  it("always starts with the Auto option", () => {
    const r = buildModelOptions(["a", "b"], "", "");
    expect(r.options[0]).toEqual({ value: "", label: "Auto (provider default)" });
  });

  it("selects a stored model that is in the provider defaults", () => {
    const r = buildModelOptions(["m1", "m2"], "", "m2");
    expect(r.selected).toBe("m2");
    expect(r.options.map((o) => o.value)).toEqual(["", "m1", "m2"]);
  });

  it("keeps a stored model missing from defaults as a selected (saved) option", () => {
    const r = buildModelOptions(
      ["meta/llama-3.3-70b-instruct"],
      "",
      "nousresearch/hermes-3-llama-3.1-70b"
    );
    const saved = r.options[r.options.length - 1]!;
    expect(saved.value).toBe("nousresearch/hermes-3-llama-3.1-70b");
    expect(saved.label).toContain("(saved)");
    // Regression: the old code added the option but never selected it,
    // and the provider-change persist then silently wiped the model.
    expect(r.selected).toBe("nousresearch/hermes-3-llama-3.1-70b");
  });

  it("does not duplicate the stored model when it is in the defaults", () => {
    const r = buildModelOptions(["m1"], "", "m1");
    expect(r.options.filter((o) => o.value === "m1")).toHaveLength(1);
  });

  it("selects Auto (empty) when a custom model id is typed", () => {
    const r = buildModelOptions(["m1"], "  my-custom-model  ", "m1");
    expect(r.selected).toBe("");
  });

  it("selects Auto when nothing is stored", () => {
    const r = buildModelOptions(["m1"], "", "");
    expect(r.selected).toBe("");
  });

  it("handles missing/empty defaults without crashing", () => {
    const r = buildModelOptions(null, "", "kept-model");
    expect(r.options[0]!.value).toBe("");
    expect(r.options[r.options.length - 1]!.value).toBe("kept-model");
    expect(r.selected).toBe("kept-model");
  });

  it("trims whitespace on custom and stored values", () => {
    const r = buildModelOptions(["m1"], "   ", "  m1  ");
    expect(r.selected).toBe("m1");
  });

  it("treats null/undefined inputs as empty", () => {
    const r = buildModelOptions(undefined, null, undefined);
    expect(r.selected).toBe("");
    expect(r.options).toHaveLength(1);
  });
});
