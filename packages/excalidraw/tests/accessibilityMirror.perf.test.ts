import { API } from "./helpers/api";
import { arrayToMap } from "../utils";
import { buildMirrorModel } from "../a11y/mirrorModel";

import type { Bounds } from "../element/bounds";
import type { ElementsMap, ExcalidrawElement } from "../element/types";

/**
 * Performance budget: on a 5000-element scene, dragging a single element must
 * produce a mirror update (the incremental `buildMirrorModel` recompute) in
 * under one frame (16 ms), averaged over 100 iterations.
 *
 * `buildMirrorModel` is the per-frame work the mirror does on every scene
 * change; React then reconciles only the small mounted subset. We measure the
 * model recompute here because it is the part that scales with scene size.
 */
describe("accessibility mirror — performance", () => {
  it("updates in under 16ms per single-element drag on a 5000-element scene", () => {
    const COUNT = 5000;
    const GRID = Math.ceil(Math.sqrt(COUNT));
    const SPACING = 60;

    const elements: ExcalidrawElement[] = [];
    for (let i = 0; i < COUNT; i++) {
      const col = i % GRID;
      const row = Math.floor(i / GRID);
      elements.push(
        API.createElement({
          type: "rectangle",
          id: `e${i}`,
          x: col * SPACING,
          y: row * SPACING,
          width: 40,
          height: 40,
        }),
      );
    }

    const elementsMap = arrayToMap(elements) as ElementsMap;
    // a viewport covering a realistic subset of the scene
    const viewportBounds: Bounds = [0, 0, 2000, 2000];

    const run = (focusedElementId: string | null) =>
      buildMirrorModel({
        elements,
        elementsMap,
        selectedElementIds: { e0: true },
        focusedElementId,
        viewportBounds,
      });

    // warm up the memoized bounds cache (first pass computes all bounds)
    run("e0");

    const ITERATIONS = 100;
    const durations: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      // simulate dragging element 0: a new object with bumped version forces
      // exactly one bounds recompute, mimicking a real drag frame
      const prev = elements[0];
      const dragged = {
        ...prev,
        x: prev.x + 1,
        version: prev.version + 1,
        versionNonce: prev.versionNonce + 1,
      } as ExcalidrawElement;
      elements[0] = dragged;
      elementsMap.set(dragged.id, dragged);

      const start = performance.now();
      run(dragged.id);
      durations.push(performance.now() - start);
    }

    const total = durations.reduce((sum, d) => sum + d, 0);
    const average = total / ITERATIONS;
    const max = Math.max(...durations);

    // primary assertion: average update is within the one-frame budget
    expect(average).toBeLessThan(16);
    // sanity: the model actually mounted a virtualized subset (not all 5000)
    const model = run("e0");
    expect(model.mounted.size).toBeGreaterThan(0);
    expect(model.mounted.size).toBeLessThan(COUNT);

    // eslint-disable-next-line no-console
    console.log(
      `mirror update over ${ITERATIONS} drags: avg=${average.toFixed(
        3,
      )}ms max=${max.toFixed(3)}ms mounted=${model.mounted.size}/${COUNT}`,
    );
  });
});
