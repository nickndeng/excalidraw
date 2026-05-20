import { API } from "../tests/helpers/api";
import { arrayToMap } from "../utils";

import {
  isMirrorNavigable,
  isMirrorFocusable,
  buildMirrorModel,
  buildSpatialItems,
} from "./mirrorModel";

import type { Bounds } from "../element/bounds";
import type { ElementsMap, ExcalidrawElement } from "../element/types";

const map = (elements: ExcalidrawElement[]) =>
  arrayToMap(elements) as ElementsMap;

describe("isMirrorNavigable", () => {
  it("excludes selection elements and bound text", () => {
    const rect = API.createElement({ type: "rectangle" });
    const boundText = API.createElement({
      type: "text",
      text: "x",
      containerId: rect.id,
    });
    const freeText = API.createElement({ type: "text", text: "y" });
    expect(isMirrorNavigable(rect)).toBe(true);
    expect(isMirrorNavigable(boundText)).toBe(false);
    expect(isMirrorNavigable(freeText)).toBe(true);
  });

  it("excludes deleted elements", () => {
    const rect = API.createElement({ type: "rectangle", isDeleted: true });
    expect(isMirrorNavigable(rect)).toBe(false);
  });
});

describe("isMirrorFocusable", () => {
  it("treats frames as non-focusable groups", () => {
    const frame = API.createElement({ type: "frame" });
    const rect = API.createElement({ type: "rectangle" });
    expect(isMirrorNavigable(frame)).toBe(true);
    expect(isMirrorFocusable(frame)).toBe(false);
    expect(isMirrorFocusable(rect)).toBe(true);
  });
});

describe("buildMirrorModel", () => {
  it("nests frame children and flattens tab order pre-order (z-order)", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    const child1 = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      frameId: frame.id,
    });
    const child2 = API.createElement({
      type: "ellipse",
      x: 20,
      y: 20,
      frameId: frame.id,
    });
    const outside = API.createElement({ type: "rectangle", x: 400, y: 400 });

    // z-order: frame, child1, child2, outside
    const elements = [frame, child1, child2, outside];
    const model = buildMirrorModel({
      elements,
      elementsMap: map(elements),
      selectedElementIds: {},
      focusedElementId: null,
      viewportBounds: null,
    });

    expect(model.tree).toHaveLength(2); // frame + outside at top level
    const frameNode = model.tree[0];
    expect(frameNode.isFrame).toBe(true);
    expect(frameNode.children.map((c) => c.id)).toEqual([child1.id, child2.id]);

    // frames are non-focusable groups: focusable tab order excludes the frame
    // but keeps its children in the frame's position, before the next sibling
    expect(model.order).toEqual([child1.id, child2.id, outside.id]);
  });

  it("mounts only viewport-intersecting elements", () => {
    const onScreen = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const offScreen = API.createElement({
      type: "rectangle",
      x: 5000,
      y: 5000,
      width: 50,
      height: 50,
    });
    const elements = [onScreen, offScreen];
    const viewport: Bounds = [0, 0, 1000, 1000];

    const model = buildMirrorModel({
      elements,
      elementsMap: map(elements),
      selectedElementIds: {},
      focusedElementId: null,
      viewportBounds: viewport,
    });

    expect(model.mounted.has(onScreen.id)).toBe(true);
    expect(model.mounted.has(offScreen.id)).toBe(false);
  });

  it("mounts the focused element and one z-order neighbor on each side", () => {
    const els = Array.from({ length: 5 }, (_, i) =>
      API.createElement({ type: "rectangle", x: i * 2000, y: 0, id: `r${i}` }),
    );
    const model = buildMirrorModel({
      elements: els,
      elementsMap: map(els),
      selectedElementIds: {},
      focusedElementId: "r2",
      viewportBounds: null, // isolate the focus-neighborhood rule
    });

    expect([...model.mounted].sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("mounts every child of the focused frame", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      id: "f",
    });
    const c1 = API.createElement({
      type: "rectangle",
      frameId: "f",
      id: "c1",
      x: 9000,
      y: 9000,
    });
    const c2 = API.createElement({
      type: "rectangle",
      frameId: "f",
      id: "c2",
      x: 9100,
      y: 9100,
    });
    const elements = [frame, c1, c2];

    // focus on a child → all siblings + the frame group are mounted
    const model = buildMirrorModel({
      elements,
      elementsMap: map(elements),
      selectedElementIds: {},
      focusedElementId: "c1",
      viewportBounds: null,
    });

    expect(model.mounted.has("c1")).toBe(true);
    expect(model.mounted.has("c2")).toBe(true);
    expect(model.mounted.has("f")).toBe(true);
  });

  it("always mounts a frame ancestor when a child is mounted", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      id: "f",
    });
    const child = API.createElement({
      type: "rectangle",
      frameId: "f",
      id: "c",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const elements = [frame, child];

    const model = buildMirrorModel({
      elements,
      elementsMap: map(elements),
      selectedElementIds: {},
      focusedElementId: null,
      viewportBounds: [0, 0, 50, 50], // only the child intersects nothing extra
    });

    expect(model.mounted.has("c")).toBe(true);
    expect(model.mounted.has("f")).toBe(true);
  });

  it("keeps selected elements mounted even off-screen", () => {
    const el = API.createElement({
      type: "rectangle",
      x: 9000,
      y: 9000,
      id: "sel",
    });
    const model = buildMirrorModel({
      elements: [el],
      elementsMap: map([el]),
      selectedElementIds: { sel: true },
      focusedElementId: null,
      viewportBounds: [0, 0, 100, 100],
    });
    expect(model.mounted.has("sel")).toBe(true);
  });
});

describe("buildSpatialItems", () => {
  it("returns centroids for focusable elements only (no bound text, no frames)", () => {
    const rect = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const boundText = API.createElement({
      type: "text",
      text: "x",
      containerId: rect.id,
    });
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const items = buildSpatialItems(
      [rect, boundText, frame],
      map([rect, boundText, frame]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ id: rect.id, center: { x: 50, y: 50 } });
  });
});
