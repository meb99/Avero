// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ValueInput } from "./MeasureBlock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(onChange: (v: unknown) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ValueInput, { value: 0.45, quantity: "diode", onChange, label: "D" })));
  const input = host.querySelector("input")!;
  const type = (text: string) =>
    act(() => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return { input, type, root };
}

describe("value field", () => {
  it("drops the edit on Escape", () => {
    const got: unknown[] = [];
    const { input, type } = mount((v) => got.push(v));
    type("0,8");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(got).toEqual([]);
    expect(input.value).toMatch(/0[.,]45/);
  });

  it("saves the edit on Enter", () => {
    const got: unknown[] = [];
    const { input, type } = mount((v) => got.push(v));
    type("0,8");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(got).toEqual([0.8]);
  });
});
