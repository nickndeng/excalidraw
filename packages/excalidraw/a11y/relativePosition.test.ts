import { API } from "../tests/helpers/api";
import { arrayToMap } from "../utils";
import { t } from "../i18n";

import {
  getPositionRegion,
  describeRelativePosition,
} from "./relativePosition";

import type { Bounds } from "../element/bounds";
import type { ElementsMap } from "../element/types";

const SCENE: Bounds = [0, 0, 300, 300];

describe("getPositionRegion", () => {
  it("maps centroids onto the 3x3 grid", () => {
    expect(getPositionRegion({ x: 25, y: 25 }, SCENE)).toBe("topLeft");
    expect(getPositionRegion({ x: 150, y: 25 }, SCENE)).toBe("top");
    expect(getPositionRegion({ x: 275, y: 25 }, SCENE)).toBe("topRight");
    expect(getPositionRegion({ x: 25, y: 150 }, SCENE)).toBe("left");
    expect(getPositionRegion({ x: 150, y: 150 }, SCENE)).toBe("center");
    expect(getPositionRegion({ x: 275, y: 150 }, SCENE)).toBe("right");
    expect(getPositionRegion({ x: 25, y: 275 }, SCENE)).toBe("bottomLeft");
    expect(getPositionRegion({ x: 150, y: 275 }, SCENE)).toBe("bottom");
    expect(getPositionRegion({ x: 275, y: 275 }, SCENE)).toBe("bottomRight");
  });

  it("clamps out-of-bounds centroids", () => {
    expect(getPositionRegion({ x: -50, y: -50 }, SCENE)).toBe("topLeft");
    expect(getPositionRegion({ x: 9999, y: 9999 }, SCENE)).toBe("bottomRight");
  });

  it("handles degenerate (zero-area) bounds", () => {
    expect(getPositionRegion({ x: 5, y: 5 }, [5, 5, 5, 5])).toBe("topLeft");
  });

  it("mirrors the horizontal axis under RTL", () => {
    expect(getPositionRegion({ x: 25, y: 25 }, SCENE, true)).toBe("topRight");
    expect(getPositionRegion({ x: 275, y: 25 }, SCENE, true)).toBe("topLeft");
    // center column and vertical axis are unaffected
    expect(getPositionRegion({ x: 150, y: 150 }, SCENE, true)).toBe("center");
  });
});

describe("describeRelativePosition", () => {
  it("describes a top-left element relative to the canvas", () => {
    const el = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const map = arrayToMap([el]) as ElementsMap;
    expect(
      describeRelativePosition({
        element: el,
        elementsMap: map,
        frame: null,
        sceneBounds: SCENE,
        isRTL: false,
        t,
      }),
    ).toBe(t("a11y.position.topLeft"));
  });

  it("describes an element inside a frame by the frame label", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    (frame as any).name = "Notes";
    const child = API.createElement({
      type: "rectangle",
      x: 10,
      y: 10,
      frameId: frame.id,
    });
    const map = arrayToMap([frame, child]) as ElementsMap;
    expect(
      describeRelativePosition({
        element: child,
        elementsMap: map,
        frame,
        sceneBounds: SCENE,
        isRTL: false,
        t,
      }),
    ).toBe(t("a11y.position.insideFrame", { frame: "Notes" }));
  });

  it("mirrors the descriptor under RTL", () => {
    const el = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const map = arrayToMap([el]) as ElementsMap;
    expect(
      describeRelativePosition({
        element: el,
        elementsMap: map,
        frame: null,
        sceneBounds: SCENE,
        isRTL: true,
        t,
      }),
    ).toBe(t("a11y.position.topRight"));
  });
});
