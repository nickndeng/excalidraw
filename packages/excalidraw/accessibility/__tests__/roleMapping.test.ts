/**
 * Unit tests for the ARIA role-mapping helper.
 *
 * One test per element type, plus state-composition (selected, locked,
 * editing) tests. The helper is the single source of truth for element
 * → role/name/state, so its coverage gates a lot of the mirror's
 * correctness.
 */

import { describe, expect, it } from "vitest";

import {
  getElementText,
  getElementTypeLabel,
  getMirrorDescriptor,
} from "../roleMapping";
import { API } from "../../tests/helpers/api";

const baseInput = {
  positionDescriptor: "top-left of canvas",
  isSelected: false,
  isEditing: false,
};

describe("roleMapping.getElementTypeLabel", () => {
  it("labels rectangles", () => {
    const el = API.createElement({ type: "rectangle" });
    expect(getElementTypeLabel(el)).toBe("Rectangle");
  });
  it("labels diamonds", () => {
    const el = API.createElement({ type: "diamond" });
    expect(getElementTypeLabel(el)).toBe("Diamond");
  });
  it("labels ellipses", () => {
    const el = API.createElement({ type: "ellipse" });
    expect(getElementTypeLabel(el)).toBe("Ellipse");
  });
  it("labels text", () => {
    const el = API.createElement({ type: "text", text: "Hi" });
    expect(getElementTypeLabel(el)).toBe("Text");
  });
  it("labels arrows", () => {
    const el = API.createElement({ type: "arrow" });
    expect(getElementTypeLabel(el)).toBe("Arrow");
  });
  it("labels lines", () => {
    const el = API.createElement({ type: "line" });
    expect(getElementTypeLabel(el)).toBe("Line");
  });
  it("labels freedraw", () => {
    const el = API.createElement({ type: "freedraw" });
    expect(getElementTypeLabel(el)).toBe("Freehand drawing");
  });
  it("labels images", () => {
    const el = API.createElement({ type: "image" });
    expect(getElementTypeLabel(el)).toBe("Image");
  });
  it("labels frames", () => {
    const el = API.createElement({ type: "frame" });
    expect(getElementTypeLabel(el)).toBe("Frame");
  });
  it("labels magicframes", () => {
    const el = API.createElement({ type: "magicframe" });
    expect(getElementTypeLabel(el)).toBe("Magic frame");
  });
  it("labels iframes", () => {
    const el = API.createElement({ type: "iframe" });
    expect(getElementTypeLabel(el)).toBe("Embedded page");
  });
  it("labels embeddables", () => {
    const el = API.createElement({ type: "embeddable" });
    expect(getElementTypeLabel(el)).toBe("Embedded content");
  });
});

describe("roleMapping.getElementText", () => {
  it("returns the text for text elements", () => {
    const el = API.createElement({ type: "text", text: "hello" });
    expect(getElementText(el)).toBe("hello");
  });
  it("returns null for shapes without text", () => {
    const el = API.createElement({ type: "rectangle" });
    expect(getElementText(el)).toBeNull();
  });
  it("returns the frame name", () => {
    const el = API.createElement({ type: "frame" });
    (el as any).name = "Notes";
    expect(getElementText(el)).toBe("Notes");
  });
  it("returns null for an unnamed frame", () => {
    const el = API.createElement({ type: "frame" });
    (el as any).name = null;
    expect(getElementText(el)).toBeNull();
  });
});

describe("roleMapping.getMirrorDescriptor", () => {
  it("composes the plain label for shapes without text", () => {
    const el = API.createElement({ type: "rectangle" });
    const d = getMirrorDescriptor({ ...baseInput, element: el });
    expect(d.role).toBe("treeitem");
    expect(d.ariaLabel).toBe("Rectangle, top-left of canvas");
    expect(d.textContent).toBeNull();
  });

  it("composes the with-text label for text elements", () => {
    const el = API.createElement({ type: "text", text: "Greeting" });
    const d = getMirrorDescriptor({ ...baseInput, element: el });
    expect(d.ariaLabel).toBe('Text "Greeting", top-left of canvas');
    expect(d.textContent).toBe("Greeting");
  });

  it("reflects the selected state", () => {
    const el = API.createElement({ type: "rectangle" });
    const d = getMirrorDescriptor({
      ...baseInput,
      element: el,
      isSelected: true,
    });
    expect(d.ariaState.selected).toBe(true);
    expect(d.ariaState.disabled).toBe(false);
    expect(d.ariaState.editing).toBe(false);
  });

  it("reflects the locked state via aria-disabled", () => {
    const el = API.createElement({ type: "rectangle", locked: true });
    const d = getMirrorDescriptor({ ...baseInput, element: el });
    expect(d.ariaState.disabled).toBe(true);
  });

  it("appends an editing suffix and sets editing state", () => {
    const el = API.createElement({ type: "text", text: "Note" });
    const d = getMirrorDescriptor({
      ...baseInput,
      element: el,
      isEditing: true,
    });
    expect(d.ariaState.editing).toBe(true);
    expect(d.ariaLabel).toMatch(/\(editing\)$/);
  });

  it("preserves a non-text container's lack of textContent", () => {
    const el = API.createElement({ type: "diamond" });
    const d = getMirrorDescriptor({ ...baseInput, element: el });
    expect(d.textContent).toBeNull();
  });
});
