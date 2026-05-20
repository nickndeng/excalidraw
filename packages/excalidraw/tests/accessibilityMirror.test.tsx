import React from "react";

import {
  render,
  fireEvent,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
  assertSelectedElements,
  unmountComponent,
} from "./test-utils";
import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import { Pointer } from "./helpers/ui";
import { KEYS } from "../keys";

const { h } = window;
const mouse = new Pointer("mouse");

const MIRROR = ".excalidraw__a11y-mirror";
const LIVE = ".excalidraw__a11y-live";

const getMirror = () => document.querySelector(MIRROR) as HTMLElement | null;
const getOption = (id: string) =>
  document.querySelector(
    `${MIRROR} [data-element-id="${id}"]`,
  ) as HTMLElement | null;
const getOptionsInDomOrder = () =>
  Array.from(document.querySelectorAll(`${MIRROR} [role="option"]`)).map((n) =>
    n.getAttribute("data-element-id"),
  );

unmountComponent();

describe("accessibility mirror", () => {
  beforeEach(async () => {
    mockBoundingClientRect({ width: 1920, height: 1080 });
    await render(<Excalidraw />);
  });

  afterEach(() => {
    unmountComponent();
    restoreOriginalGetBoundingClientRect();
  });

  it("mounts a screen-reader listbox that is not aria-hidden", () => {
    const mirror = getMirror();
    expect(mirror).toBeTruthy();
    expect(mirror!.getAttribute("role")).toBe("listbox");
    expect(mirror!.getAttribute("aria-multiselectable")).toBe("true");
    expect(mirror!.getAttribute("aria-hidden")).toBeNull();
    expect(mirror!.getAttribute("aria-label")).toBeTruthy();

    const live = document.querySelector(LIVE) as HTMLElement;
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("can be disabled via the accessibilityMirror prop", async () => {
    // drop the mirror-enabled instance from beforeEach before rendering a
    // fresh one with the mirror disabled
    unmountComponent();
    mockBoundingClientRect({ width: 1920, height: 1080 });
    await render(<Excalidraw accessibilityMirror={false} />);
    expect(getMirror()).toBeNull();
  });

  it("renders nodes in z-order, with frame children nested before the next sibling", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    const child = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      frameId: frame.id,
    });
    const outside = API.createElement({
      type: "ellipse",
      x: 400,
      y: 10,
      width: 20,
      height: 20,
    });
    // z-order: frame, child, outside
    API.setElements([frame, child, outside]);

    // frame is a group, not a focusable option; its child is nested first
    expect(getOptionsInDomOrder()).toEqual([child.id, outside.id]);

    // the frame renders as an ARIA group with an accessible name
    const group = document.querySelector(`${MIRROR} [role="group"]`)!;
    expect(group.getAttribute("aria-label")).toBeTruthy();
    expect(group.querySelector(`[data-element-id="${child.id}"]`)).toBeTruthy();
  });

  it("exposes role, accessible name and ARIA state per element", () => {
    const rect = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const locked = API.createElement({
      type: "rectangle",
      x: 100,
      y: 0,
      width: 50,
      height: 50,
      locked: true,
    });
    API.setElements([rect, locked]);

    const rectNode = getOption(rect.id)!;
    expect(rectNode.getAttribute("role")).toBe("option");
    expect(rectNode.getAttribute("aria-selected")).toBe("false");
    expect(rectNode.textContent).toMatch(/Rectangle/);

    expect(getOption(locked.id)!.getAttribute("aria-disabled")).toBe("true");
  });

  it("Tab order follows z-order (one focusable node per element)", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 30,
      height: 30,
    });
    const b = API.createElement({
      type: "ellipse",
      x: 100,
      y: 0,
      width: 30,
      height: 30,
    });
    const c = API.createElement({ type: "text", text: "hi", x: 200, y: 0 });
    API.setElements([a, b, c]);
    getOptionsInDomOrder().forEach((id) => expect(id).toBeTruthy());
    expect(getOptionsInDomOrder()).toEqual([a.id, b.id, c.id]);
  });

  it("arrow keys move focus to the geometrically correct neighbor", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    }); // center 25,25
    const right = API.createElement({
      type: "rectangle",
      x: 200,
      y: 0,
      width: 50,
      height: 50,
    }); // center 225,25
    const down = API.createElement({
      type: "rectangle",
      x: 0,
      y: 200,
      width: 50,
      height: 50,
    }); // center 25,225
    API.setElements([a, right, down]);

    const aNode = getOption(a.id)!;
    aNode.focus();

    fireEvent.keyDown(aNode, { key: KEYS.ARROW_RIGHT });
    expect(document.activeElement).toBe(getOption(right.id));

    fireEvent.keyDown(getOption(right.id)!, { key: KEYS.ARROW_LEFT });
    expect(document.activeElement).toBe(getOption(a.id));

    fireEvent.keyDown(getOption(a.id)!, { key: KEYS.ARROW_DOWN });
    expect(document.activeElement).toBe(getOption(down.id));
  });

  it("selection round-trips between mirror-Enter and canvas clicks", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    // filled so a click in its interior hits it (transparent shapes are only
    // hit on their stroke)
    const b = API.createElement({
      type: "rectangle",
      x: 200,
      y: 0,
      width: 50,
      height: 50,
      backgroundColor: "red",
      fillStyle: "solid",
    });
    API.setElements([a, b]);

    // mirror-driven selection
    const aNode = getOption(a.id)!;
    aNode.focus();
    fireEvent.keyDown(aNode, { key: KEYS.ENTER });
    assertSelectedElements([a.id]);
    expect(getOption(a.id)!.getAttribute("aria-selected")).toBe("true");

    // pressing Enter again toggles it off
    fireEvent.keyDown(getOption(a.id)!, { key: KEYS.ENTER });
    assertSelectedElements([]);

    // canvas-driven selection is reflected in the mirror
    mouse.clickAt(225, 25);
    assertSelectedElements([b.id]);
    expect(getOption(b.id)!.getAttribute("aria-selected")).toBe("true");
  });

  it("supports multi-select with Shift+Enter", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const b = API.createElement({
      type: "rectangle",
      x: 200,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([a, b]);

    getOption(a.id)!.focus();
    fireEvent.keyDown(getOption(a.id)!, { key: KEYS.ENTER });
    // move focus to b (as Tab/arrow would) before adding it to the selection
    getOption(b.id)!.focus();
    fireEvent.keyDown(getOption(b.id)!, { key: KEYS.ENTER, shiftKey: true });
    assertSelectedElements([a.id, b.id]);
  });

  it("Delete removes the selected element(s)", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([a]);

    const aNode = getOption(a.id)!;
    aNode.focus();
    fireEvent.keyDown(aNode, { key: KEYS.ENTER });
    assertSelectedElements([a.id]);

    fireEvent.keyDown(getOption(a.id)!, { key: KEYS.DELETE });
    expect(h.elements.filter((el) => !el.isDeleted)).toHaveLength(0);
  });

  it("Escape clears selection and returns focus to the canvas container", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([a]);

    const aNode = getOption(a.id)!;
    aNode.focus();
    fireEvent.keyDown(aNode, { key: KEYS.ENTER });
    assertSelectedElements([a.id]);

    fireEvent.keyDown(getOption(a.id)!, { key: KEYS.ESCAPE });
    assertSelectedElements([]);

    const container = document.querySelector(
      ".excalidraw.excalidraw-container",
    );
    expect(document.activeElement).toBe(container);
  });

  it("F2 enters the canvas text editor for a text-bearing element", () => {
    const text = API.createElement({
      type: "text",
      text: "edit me",
      x: 0,
      y: 0,
    });
    API.setElements([text]);

    const node = getOption(text.id)!;
    node.focus();
    fireEvent.keyDown(node, { key: "F2" });

    expect(h.state.editingTextElement?.id).toBe(text.id);
  });

  it("announces selection changes via the live region", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([a]);

    const aNode = getOption(a.id)!;
    aNode.focus();
    fireEvent.keyDown(aNode, { key: KEYS.ENTER });

    const live = document.querySelector(LIVE) as HTMLElement;
    expect(live.textContent).toMatch(/Selected/);
    expect(live.textContent).toMatch(/Rectangle/);
  });
});
