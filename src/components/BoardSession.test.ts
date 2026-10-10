// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardSessionProvider, useBoardSession, type BoardSession } from "./BoardSession";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function SideName() {
  return createElement("span", null, useBoardSession().side);
}

function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

describe("board session", () => {
  it("hands the app's session to the sidebar's tabs", () => {
    const session = { side: "bottom" } as unknown as BoardSession;
    const host = render(createElement(BoardSessionProvider, { value: session, children: createElement(SideName) }));
    expect(host.textContent).toBe("bottom");
  });

  it("refuses to be read outside a provider", () => {
    expect(() => renderToString(createElement(SideName))).toThrow(/outside a BoardSessionProvider/);
  });
});
