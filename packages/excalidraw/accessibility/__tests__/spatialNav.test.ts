/**
 * Unit tests for spatial navigation (directional cone neighbour search).
 *
 * Builds synthetic 4-direction layouts and asserts that each arrow
 * direction picks the geometrically-correct neighbour. Also tests
 * tie-break, RTL mirroring, and degenerate cases (coincident centroids,
 * empty candidate list).
 */

import { describe, expect, it } from "vitest";

import { findSpatialNeighbor, mirrorDirectionForRTL } from "../spatialNav";
import { API } from "../../tests/helpers/api";

/**
 * Place an element at a centroid (cx, cy) with a 20x20 bbox.
 */
const at = (id: string, cx: number, cy: number) => {
  const el = API.createElement({
    type: "rectangle",
    id,
    x: cx - 10,
    y: cy - 10,
    width: 20,
    height: 20,
  });
  return el;
};

describe("spatialNav.findSpatialNeighbor", () => {
  // Layout:
  //          north (200, 100)
  // west (100, 200)  C (200, 200)   east (300, 200)
  //          south (200, 300)
  const center = at("C", 200, 200);
  const north = at("N", 200, 100);
  const south = at("S", 200, 300);
  const east = at("E", 300, 200);
  const west = at("W", 100, 200);
  const all = [center, north, south, east, west];

  it("picks the east neighbour for right", () => {
    const result = findSpatialNeighbor({
      current: center,
      candidates: all,
      direction: "right",
    });
    expect(result?.id).toBe("E");
  });

  it("picks the west neighbour for left", () => {
    const result = findSpatialNeighbor({
      current: center,
      candidates: all,
      direction: "left",
    });
    expect(result?.id).toBe("W");
  });

  it("picks the north neighbour for up", () => {
    const result = findSpatialNeighbor({
      current: center,
      candidates: all,
      direction: "up",
    });
    expect(result?.id).toBe("N");
  });

  it("picks the south neighbour for down", () => {
    const result = findSpatialNeighbor({
      current: center,
      candidates: all,
      direction: "down",
    });
    expect(result?.id).toBe("S");
  });

  it("returns null when no candidate is in the cone", () => {
    // Only off-axis candidates beyond the 30° cone.
    const ne = at("NE", 300, 100);
    const result = findSpatialNeighbor({
      current: center,
      candidates: [ne],
      direction: "right",
    });
    // NE is 45° above axis — outside the ±30° cone.
    expect(result).toBeNull();
  });

  it("includes candidates just inside the cone", () => {
    // ~25° above the right axis: candidate at (300, 200 - 100*tan25)
    // which is ~(300, 153). Still inside ±30° cone.
    const nearRight = at("NR", 300, 153);
    const result = findSpatialNeighbor({
      current: center,
      candidates: [nearRight],
      direction: "right",
    });
    expect(result?.id).toBe("NR");
  });

  it("breaks ties by centroid distance", () => {
    // Two candidates to the right, one closer than the other.
    const close = at("close", 250, 200);
    const far = at("far", 400, 200);
    const result = findSpatialNeighbor({
      current: center,
      candidates: [far, close],
      direction: "right",
    });
    expect(result?.id).toBe("close");
  });

  it("ignores deleted candidates", () => {
    const deleted = at("X", 300, 200);
    (deleted as any).isDeleted = true;
    const result = findSpatialNeighbor({
      current: center,
      candidates: [deleted],
      direction: "right",
    });
    expect(result).toBeNull();
  });

  it("ignores coincident candidates", () => {
    const coincident = at("C2", 200, 200);
    const result = findSpatialNeighbor({
      current: center,
      candidates: [coincident, east],
      direction: "right",
    });
    expect(result?.id).toBe("E");
  });

  it("does not return self", () => {
    const result = findSpatialNeighbor({
      current: center,
      candidates: [center],
      direction: "right",
    });
    expect(result).toBeNull();
  });

  it("rejects elements behind the cone axis", () => {
    // A candidate to the left when we ask for "right".
    const back = at("B", 100, 200);
    const result = findSpatialNeighbor({
      current: center,
      candidates: [back],
      direction: "right",
    });
    expect(result).toBeNull();
  });
});

describe("spatialNav.mirrorDirectionForRTL", () => {
  it("swaps left and right", () => {
    expect(mirrorDirectionForRTL("left")).toBe("right");
    expect(mirrorDirectionForRTL("right")).toBe("left");
  });

  it("leaves up and down alone", () => {
    expect(mirrorDirectionForRTL("up")).toBe("up");
    expect(mirrorDirectionForRTL("down")).toBe("down");
  });
});
