/**
 * Unit tests for the mount-set virtualization.
 *
 * Verifies:
 *   - Viewport intersection
 *   - z-order neighbour expansion around focus
 *   - Frame children are nested in DFS order
 *   - Mount-list equality is order-sensitive
 *   - Off-screen + unfocused elements are excluded
 */

import { describe, expect, it } from "vitest";

import { computeMirrorMountSet, mountListsEqual } from "../virtualization";
import { API } from "../../tests/helpers/api";
import type { NonDeletedExcalidrawElement } from "../../element/types";

const viewport = { x: 0, y: 0, width: 1000, height: 1000 };

const place = (
  id: string,
  x: number,
  y: number,
  frameId: string | null = null,
) => {
  const el = API.createElement({
    type: "rectangle",
    id,
    x,
    y,
    width: 50,
    height: 50,
    frameId,
  });
  return el as NonDeletedExcalidrawElement;
};

describe("virtualization.computeMirrorMountSet", () => {
  it("includes only viewport-visible elements when nothing focused", () => {
    const inViewport = place("in", 100, 100);
    const offScreen = place("off", 5000, 5000);
    const result = computeMirrorMountSet({
      elements: [inViewport, offScreen],
      viewport,
      focusedElementId: null,
    });
    expect(result.map((e) => e.id)).toEqual(["in"]);
  });

  it("includes the focused element even when off-screen", () => {
    const inViewport = place("in", 100, 100);
    const offScreen = place("off", 5000, 5000);
    const result = computeMirrorMountSet({
      elements: [inViewport, offScreen],
      viewport,
      focusedElementId: "off",
    });
    expect(result.map((e) => e.id).sort()).toEqual(["in", "off"]);
  });

  it("includes focus's z-order neighbours", () => {
    const a = place("a", 5000, 5000);
    const b = place("b", 5000, 5100);
    const c = place("c", 5000, 5200);
    const d = place("d", 5000, 5300);
    const e = place("e", 5000, 5400);
    const f = place("f", 5000, 5500);
    const result = computeMirrorMountSet({
      elements: [a, b, c, d, e, f],
      viewport,
      focusedElementId: "c",
    });
    // c ± 2 = [a, b, c, d, e]
    expect(result.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("places frame children depth-first after the frame", () => {
    const frame = API.createElement({
      type: "frame",
      id: "F1",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
    }) as NonDeletedExcalidrawElement;
    const sibling = place("sib", 100, 100);
    const child1 = place("c1", 50, 50, "F1");
    const child2 = place("c2", 60, 60, "F1");
    // z-order: frame, child1, child2, sibling
    const result = computeMirrorMountSet({
      elements: [frame, child1, child2, sibling],
      viewport,
      focusedElementId: null,
    });
    expect(result.map((x) => x.id)).toEqual(["F1", "c1", "c2", "sib"]);
  });

  it("mounts all children of the focused frame regardless of viewport", () => {
    const frame = API.createElement({
      type: "frame",
      id: "F1",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
    }) as NonDeletedExcalidrawElement;
    const visibleChild = place("vc", 50, 50, "F1");
    const offscreenChild = place("oc", 9000, 9000, "F1");
    const result = computeMirrorMountSet({
      elements: [frame, visibleChild, offscreenChild],
      viewport,
      focusedElementId: "F1",
    });
    expect(new Set(result.map((x) => x.id))).toEqual(
      new Set(["F1", "vc", "oc"]),
    );
  });

  it("preserves z-order across the full output", () => {
    const a = place("a", 100, 100);
    const b = place("b", 200, 200);
    const c = place("c", 300, 300);
    const result = computeMirrorMountSet({
      elements: [a, b, c],
      viewport,
      focusedElementId: null,
    });
    expect(result.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("virtualization.mountListsEqual", () => {
  it("treats identical ordered lists as equal", () => {
    const a = place("a", 0, 0);
    const b = place("b", 0, 0);
    expect(mountListsEqual([a, b], [a, b])).toBe(true);
  });
  it("treats different orderings as unequal", () => {
    const a = place("a", 0, 0);
    const b = place("b", 0, 0);
    expect(mountListsEqual([a, b], [b, a])).toBe(false);
  });
  it("treats different lengths as unequal", () => {
    const a = place("a", 0, 0);
    const b = place("b", 0, 0);
    expect(mountListsEqual([a, b], [a])).toBe(false);
  });
});
