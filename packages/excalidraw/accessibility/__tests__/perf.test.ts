/**
 * Performance test for the mirror's hot path.
 *
 * Requirement: "on a 5000-element scene, dragging a single element produces
 * a mirror update in under one frame (16 ms) on a typical laptop."
 *
 * The mirror's update is dominated by:
 *   1. computeViewportBounds — O(1).
 *   2. indexElementsById      — O(n) Map build.
 *   3. computeMirrorMountSet  — O(n) viewport intersect + filter.
 *
 * React reconciliation is React's responsibility and is not part of this
 * budget — we measure only the deterministic, JS-side work that we own.
 * Note that "dragging" in Excalidraw replaces the dragged element with a
 * new object (immutable-update pattern) but the *array* identity is also
 * new every frame, so memoization can't short-circuit. We must compute.
 *
 * Budget: mean < 16 ms over 100 iterations. We assert the *mean* rather
 * than the max because JS engine warmup, GC, and CI noise can spike a
 * single iteration well above the budget without indicating real
 * regression.
 */

import { describe, expect, it } from "vitest";

import { computeMirrorMountSet } from "../virtualization";
import { API } from "../../tests/helpers/api";
import type { NonDeletedExcalidrawElement } from "../../element/types";

const ELEMENT_COUNT = 5000;
const ITERATIONS = 100;
const MAX_MEAN_MS = 16;

const buildScene = (count: number): NonDeletedExcalidrawElement[] => {
  const elements: NonDeletedExcalidrawElement[] = [];
  // Lay out in a 100-wide grid; ensures roughly half are in the
  // 2000x2000 viewport at any time.
  for (let i = 0; i < count; i++) {
    const x = (i % 100) * 50;
    const y = Math.floor(i / 100) * 50;
    elements.push(
      API.createElement({
        type: "rectangle",
        id: `e${i}`,
        x,
        y,
        width: 40,
        height: 40,
      }) as NonDeletedExcalidrawElement,
    );
  }
  return elements;
};

describe("accessibility mirror perf", () => {
  it("computes the mount set in under 16 ms mean over 100 iterations on a 5000-element scene", () => {
    const elements = buildScene(ELEMENT_COUNT);
    const viewport = { x: 0, y: 0, width: 2000, height: 2000 };

    // Warm up: JIT and Map build cost shouldn't be charged to the first
    // measurement.
    for (let i = 0; i < 5; i++) {
      computeMirrorMountSet({
        elements,
        viewport,
        focusedElementId: "e0",
      });
    }

    const timings: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      // Simulate a drag: a new array with the dragged element replaced
      // by a moved copy. This matches what Excalidraw does on each
      // pointer move.
      const dragged = {
        ...elements[0],
        x: i,
        y: i,
      } as NonDeletedExcalidrawElement;
      const next = [dragged, ...elements.slice(1)];

      const start = performance.now();
      computeMirrorMountSet({
        elements: next,
        viewport,
        focusedElementId: dragged.id,
      });
      const end = performance.now();
      timings.push(end - start);
    }

    const sum = timings.reduce((a, b) => a + b, 0);
    const mean = sum / timings.length;
    const max = Math.max(...timings);
    // p95: rank-based
    const sorted = [...timings].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    // Log for diagnosis on CI failure.
    // eslint-disable-next-line no-console
    console.log(
      `[a11y-mirror perf] n=${ITERATIONS} mean=${mean.toFixed(
        2,
      )}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`,
    );

    expect(mean).toBeLessThan(MAX_MEAN_MS);
  });
});
