import { findSpatialNeighbor } from "./spatialNavigation";

import type { SpatialItem } from "./spatialNavigation";

const item = (id: string, x: number, y: number): SpatialItem => ({
  id,
  center: { x, y },
});

describe("findSpatialNeighbor", () => {
  // a plus-shaped layout around a center element
  const items: SpatialItem[] = [
    item("center", 0, 0),
    item("right", 100, 0),
    item("left", -100, 0),
    item("up", 0, -100),
    item("down", 0, 100),
  ];

  it("moves to the element directly in each direction", () => {
    expect(findSpatialNeighbor(items, "center", "right")).toBe("right");
    expect(findSpatialNeighbor(items, "center", "left")).toBe("left");
    expect(findSpatialNeighbor(items, "center", "up")).toBe("up");
    expect(findSpatialNeighbor(items, "center", "down")).toBe("down");
  });

  it("picks the nearest element within the cone", () => {
    const scene: SpatialItem[] = [
      item("a", 0, 0),
      item("near", 50, 0),
      item("far", 200, 0),
    ];
    expect(findSpatialNeighbor(scene, "a", "right")).toBe("near");
  });

  it("ignores elements outside the 60° cone", () => {
    // candidate at 45° is outside the ±30° right cone
    const scene: SpatialItem[] = [item("a", 0, 0), item("diag", 100, 100)];
    expect(findSpatialNeighbor(scene, "a", "right")).toBeNull();
    // but it's reachable going down-ish? 45° is also outside the down cone
    expect(findSpatialNeighbor(scene, "a", "down")).toBeNull();
  });

  it("includes elements just inside the cone edge", () => {
    // ~30° below the rightward axis: tan(30°)*100 ≈ 57.7
    const scene: SpatialItem[] = [item("a", 0, 0), item("edge", 100, 57)];
    expect(findSpatialNeighbor(scene, "a", "right")).toBe("edge");
  });

  it("returns null when nothing lies in the direction", () => {
    const scene: SpatialItem[] = [item("a", 0, 0), item("b", -100, 0)];
    expect(findSpatialNeighbor(scene, "a", "right")).toBeNull();
  });

  it("breaks ties deterministically (equal distance/angle → lower id)", () => {
    const scene: SpatialItem[] = [
      item("a", 0, 0),
      item("z", 100, 0),
      item("b", 100, 0),
    ];
    // b and z are identical; lower id wins
    expect(findSpatialNeighbor(scene, "a", "right")).toBe("b");
  });

  it("mirrors horizontal directions under RTL", () => {
    expect(findSpatialNeighbor(items, "center", "right", { isRTL: true })).toBe(
      "left",
    );
    expect(findSpatialNeighbor(items, "center", "left", { isRTL: true })).toBe(
      "right",
    );
    // vertical unaffected
    expect(findSpatialNeighbor(items, "center", "up", { isRTL: true })).toBe(
      "up",
    );
  });

  it("returns null for an unknown current id", () => {
    expect(findSpatialNeighbor(items, "missing", "right")).toBeNull();
  });

  it("is loop-free and reachable across a random stress scene", () => {
    // deterministic pseudo-random layout of 50 items
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const stress: SpatialItem[] = Array.from({ length: 50 }, (_, i) =>
      item(`e${String(i).padStart(2, "0")}`, rand() * 1000, rand() * 1000),
    );

    const directions = ["left", "right", "up", "down"] as const;
    for (const direction of directions) {
      for (const start of stress) {
        const next = findSpatialNeighbor(stress, start.id, direction);
        // a neighbor is either null or a *different* existing item
        if (next !== null) {
          expect(next).not.toBe(start.id);
          expect(stress.some((s) => s.id === next)).toBe(true);
        }
      }
    }
  });
});
