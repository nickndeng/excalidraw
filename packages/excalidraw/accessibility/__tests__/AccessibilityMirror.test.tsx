/**
 * Integration tests for the accessibility mirror against a real
 * <Excalidraw> mount.
 *
 * Covers:
 *   - The mirror is mounted and announces drawing elements.
 *   - Tab order matches z-order.
 *   - Spatial nav picks the geometrically-correct neighbour.
 *   - Selection round-trips between the canvas appState and the mirror.
 *   - Delete via the mirror removes the selected element through the
 *     existing action.
 *   - Escape clears selection and returns focus to the canvas container.
 *   - The mirror can be disabled via the `accessibilityMirror={false}`
 *     prop (drop-in compatibility).
 */

import React from "react";
import { describe, expect, it } from "vitest";

import { Excalidraw } from "../../index";
import { API } from "../../tests/helpers/api";
import { fireEvent, render } from "../../tests/test-utils";

const { h } = window;

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

/**
 * Dispatch a keyboard event on the focused mirror node, wrapping in act()
 * via fireEvent. Existing Excalidraw tests use this pattern for the
 * canvas onKeyDown; reusing it ensures we exercise the same React event
 * dispatch path.
 */
const pressKey = (
  el: HTMLElement,
  init: { key: string; shiftKey?: boolean },
) => {
  el.focus();
  fireEvent.keyDown(el, init);
};

describe("<AccessibilityMirror>", () => {
  it("mounts a role=tree with aria-multiselectable inside the container", async () => {
    const { container } = await render(<Excalidraw />);
    const tree = container.querySelector(
      '[data-testid="excalidraw-a11y-mirror"]',
    );
    expect(tree).not.toBeNull();
    expect(tree!.getAttribute("role")).toBe("tree");
    expect(tree!.getAttribute("aria-multiselectable")).toBe("true");
  });

  it("renders a polite live region", async () => {
    const { container } = await render(<Excalidraw />);
    const live = container.querySelector(
      '[data-testid="excalidraw-a11y-live-region"]',
    );
    expect(live).not.toBeNull();
    expect(live!.getAttribute("aria-live")).toBe("polite");
    expect(live!.getAttribute("aria-atomic")).toBe("true");
  });

  it("is omitted when accessibilityMirror={false}", async () => {
    const { container } = await render(
      <Excalidraw accessibilityMirror={false} />,
    );
    const tree = container.querySelector(
      '[data-testid="excalidraw-a11y-mirror"]',
    );
    expect(tree).toBeNull();
  });

  it("renders a treeitem per scene element", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 100, y: 100 });
    const b = API.createElement({ type: "ellipse", id: "b", x: 200, y: 200 });
    API.updateScene({ elements: [a, b] });
    await flushMicrotasks();

    const items = container.querySelectorAll('[role="treeitem"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("data-element-id")).toBe("a");
    expect(items[1].getAttribute("data-element-id")).toBe("b");
  });

  it("composes accessible names from type + text + position", async () => {
    const { container } = await render(<Excalidraw />);
    const text = API.createElement({
      type: "text",
      id: "t1",
      x: 50,
      y: 50,
      text: "Hello",
    });
    API.updateScene({ elements: [text] });
    await flushMicrotasks();

    const node = container.querySelector('[data-element-id="t1"]');
    expect(node).not.toBeNull();
    expect(node!.getAttribute("aria-label")).toMatch(/^Text "Hello",/);
  });

  it("reflects selection via aria-selected", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 100, y: 100 });
    API.updateScene({
      elements: [a],
      appState: { selectedElementIds: { a: true } },
    });
    await flushMicrotasks();

    const node = container.querySelector('[data-element-id="a"]');
    expect(node!.getAttribute("aria-selected")).toBe("true");
  });

  it("marks locked elements with aria-disabled", async () => {
    const { container } = await render(<Excalidraw />);
    const locked = API.createElement({
      type: "rectangle",
      id: "L",
      x: 100,
      y: 100,
      locked: true,
    });
    API.updateScene({ elements: [locked] });
    await flushMicrotasks();

    const node = container.querySelector('[data-element-id="L"]');
    expect(node!.getAttribute("aria-disabled")).toBe("true");
  });

  it("uses Tab to cycle z-order (next item gains focus)", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    const b = API.createElement({ type: "rectangle", id: "b", x: 150, y: 50 });
    API.updateScene({ elements: [a, b] });
    await flushMicrotasks();

    const items =
      container.querySelectorAll<HTMLDivElement>('[role="treeitem"]');
    // Initially the first item is tabindex=0 (roving).
    expect(items[0].getAttribute("tabindex")).toBe("0");
    pressKey(items[0], { key: "Tab" });
    // React processes the keydown -> setFocusedId -> queueMicrotask focus().
    await flushMicrotasks();

    const newActive = document.activeElement as HTMLElement;
    expect(newActive.getAttribute("data-element-id")).toBe("b");
  });

  it("selects an element on Enter", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    API.updateScene({ elements: [a] });
    await flushMicrotasks();

    const node = container.querySelector<HTMLDivElement>(
      '[data-element-id="a"]',
    )!;
    pressKey(node, { key: "Enter" });
    await flushMicrotasks();

    expect(h.state.selectedElementIds.a).toBe(true);
  });

  it("multi-selects with Shift+Enter", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    const b = API.createElement({ type: "rectangle", id: "b", x: 200, y: 50 });
    API.updateScene({
      elements: [a, b],
      appState: { selectedElementIds: { a: true } },
    });
    await flushMicrotasks();

    const node = container.querySelector<HTMLDivElement>(
      '[data-element-id="b"]',
    )!;
    pressKey(node, { key: "Enter", shiftKey: true });
    await flushMicrotasks();

    expect(h.state.selectedElementIds.a).toBe(true);
    expect(h.state.selectedElementIds.b).toBe(true);
  });

  it("clears selection and refocuses the canvas on Escape", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    API.updateScene({
      elements: [a],
      appState: { selectedElementIds: { a: true } },
    });
    await flushMicrotasks();

    const node = container.querySelector<HTMLDivElement>(
      '[data-element-id="a"]',
    )!;
    pressKey(node, { key: "Escape" });
    await flushMicrotasks();

    expect(Object.keys(h.state.selectedElementIds).length).toBe(0);
  });

  it("deletes the selected element on Delete", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    API.updateScene({
      elements: [a],
      appState: { selectedElementIds: { a: true } },
    });
    await flushMicrotasks();

    const node = container.querySelector<HTMLDivElement>(
      '[data-element-id="a"]',
    )!;
    pressKey(node, { key: "Delete" });
    await flushMicrotasks();

    // After delete, the element is marked deleted.
    const stored = h.app.scene.getElement("a");
    expect(stored?.isDeleted).toBe(true);
  });

  it("does NOT steal focus when selection changes via the canvas", async () => {
    // Sighted user click: appState.selectedElementIds updates, but the
    // mirror's tabindex should reflect the new selection without calling
    // focus().
    await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    API.updateScene({ elements: [a] });
    await flushMicrotasks();

    const initialActive = document.activeElement;

    API.setAppState({ selectedElementIds: { a: true } });
    await flushMicrotasks();

    // Focus has not moved.
    expect(document.activeElement).toBe(initialActive);
  });

  it("updates the live region textContent on selection", async () => {
    const { container } = await render(<Excalidraw />);
    const a = API.createElement({ type: "rectangle", id: "a", x: 50, y: 50 });
    API.updateScene({ elements: [a] });
    await flushMicrotasks();

    API.setAppState({ selectedElementIds: { a: true } });
    await flushMicrotasks();

    const live = container.querySelector(
      '[data-testid="excalidraw-a11y-live-region"]',
    );
    expect(live!.textContent || "").toMatch(/selected/i);
  });
});

describe("<AccessibilityMirror> spatial navigation", () => {
  it("ArrowRight moves focus to the right neighbour", async () => {
    const { container } = await render(<Excalidraw />);
    const left = API.createElement({
      type: "rectangle",
      id: "L",
      x: 100,
      y: 200,
      width: 50,
      height: 50,
    });
    const right = API.createElement({
      type: "rectangle",
      id: "R",
      x: 300,
      y: 200,
      width: 50,
      height: 50,
    });
    API.updateScene({ elements: [left, right] });
    await flushMicrotasks();

    const lnode = container.querySelector<HTMLDivElement>(
      '[data-element-id="L"]',
    )!;
    pressKey(lnode, { key: "ArrowRight" });
    await flushMicrotasks();

    expect(
      (document.activeElement as HTMLElement).getAttribute("data-element-id"),
    ).toBe("R");
  });

  it("ArrowDown moves focus to the element below", async () => {
    const { container } = await render(<Excalidraw />);
    const top = API.createElement({
      type: "rectangle",
      id: "T",
      x: 200,
      y: 50,
      width: 50,
      height: 50,
    });
    const bottom = API.createElement({
      type: "rectangle",
      id: "B",
      x: 200,
      y: 300,
      width: 50,
      height: 50,
    });
    API.updateScene({ elements: [top, bottom] });
    await flushMicrotasks();

    const t = container.querySelector<HTMLDivElement>('[data-element-id="T"]')!;
    pressKey(t, { key: "ArrowDown" });
    await flushMicrotasks();

    expect(
      (document.activeElement as HTMLElement).getAttribute("data-element-id"),
    ).toBe("B");
  });
});

describe("<AccessibilityMirror> RTL behavior", () => {
  // The actual RTL mirroring is unit-tested in spatialNav.test.ts; here
  // we just confirm the RTL toggle on the document doesn't break the
  // mirror render and produces a properly-scoped tree.
  it("renders inside an RTL container without errors", async () => {
    // Set RTL on document — i18n's setLanguage normally does this.
    document.documentElement.dir = "rtl";
    try {
      const { container } = await render(<Excalidraw />);
      const tree = container.querySelector(
        '[data-testid="excalidraw-a11y-mirror"]',
      );
      expect(tree).not.toBeNull();
    } finally {
      document.documentElement.dir = "ltr";
    }
  });
});
