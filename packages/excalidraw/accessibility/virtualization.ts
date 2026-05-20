/**
 * Virtualization for the accessibility mirror.
 *
 * On scenes with thousands of elements, mounting a DOM node per element
 * would defeat both performance and accessibility (a screen reader user
 * does not want to tab through 10,000 nodes). We mount a bounded subset:
 *
 *   - All elements whose bounding box intersects the current viewport.
 *   - The focused element + N z-order neighbours on each side
 *     (so Tab/Shift+Tab to the next element always works without
 *     scrolling the canvas first).
 *   - All children of the focused frame, regardless of viewport
 *     (so screen readers can read frame contents in one pass).
 *
 * The output is the *ordered* list of element IDs to mount. Order is
 * z-order with frame children nested immediately after their parent
 * (depth-first), so DOM tab order matches scene z-order.
 *
 * Incremental diff lives on the React side via stable keys — there is no
 * imperative mount/unmount API here.
 */

import { isFrameElement, isMagicFrameElement } from "../element/typeChecks";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "../element/types";

export type ViewportBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VirtualizationInput = {
  /**
   * Elements in canonical z-order (back to front). Caller is responsible
   * for filtering deleted elements.
   */
  elements: readonly NonDeletedExcalidrawElement[];
  viewport: ViewportBounds;
  focusedElementId: string | null;
  /** How many z-order neighbours on each side of focus to always mount. */
  zOrderNeighborRadius?: number;
};

const DEFAULT_NEIGHBOR_RADIUS = 2;

const intersectsViewport = (
  element: ExcalidrawElement,
  viewport: ViewportBounds,
): boolean => {
  if (element.width === 0 && element.height === 0) {
    // Degenerate; include if its origin is in viewport.
    return (
      element.x >= viewport.x &&
      element.x <= viewport.x + viewport.width &&
      element.y >= viewport.y &&
      element.y <= viewport.y + viewport.height
    );
  }
  return !(
    element.x + element.width < viewport.x ||
    element.x > viewport.x + viewport.width ||
    element.y + element.height < viewport.y ||
    element.y > viewport.y + viewport.height
  );
};

/**
 * Compute the ordered list of element IDs to mount in the mirror.
 *
 * Returns a stable ordering: depth-first traversal of frames (frame
 * treeitem immediately followed by its children, then the next top-level
 * element). This matches the Tab order requirement: "Frame children come
 * in document order before the next sibling at the parent level."
 */
export const computeMirrorMountSet = (
  input: VirtualizationInput,
): readonly NonDeletedExcalidrawElement[] => {
  const {
    elements,
    viewport,
    focusedElementId,
    zOrderNeighborRadius = DEFAULT_NEIGHBOR_RADIUS,
  } = input;

  // Map element.id -> z-order index (in the original `elements` array).
  // Used both for neighbour radius and tie-break stability.
  const zIndexById = new Map<string, number>();
  for (let i = 0; i < elements.length; i++) {
    zIndexById.set(elements[i].id, i);
  }

  // Determine the set of element IDs that must be mounted.
  const mountedIds = new Set<string>();

  // Defensive: a degenerate viewport (zero width/height) shows up in
  // headless test envs and during the brief window before the canvas
  // has measured its container. Falling back to mounting everything
  // is safer than producing an empty mirror — the alternative would
  // hide all elements from assistive tech the first time selection
  // moves before layout.
  const viewportDegenerate = viewport.width <= 0 || viewport.height <= 0;

  for (const el of elements) {
    if (viewportDegenerate || intersectsViewport(el, viewport)) {
      mountedIds.add(el.id);
    }
  }

  if (focusedElementId) {
    const focusIdx = zIndexById.get(focusedElementId);
    if (focusIdx !== undefined) {
      const lo = Math.max(0, focusIdx - zOrderNeighborRadius);
      const hi = Math.min(elements.length - 1, focusIdx + zOrderNeighborRadius);
      for (let i = lo; i <= hi; i++) {
        mountedIds.add(elements[i].id);
      }

      // If focus is inside a frame, mount all that frame's children.
      // If focus *is* a frame, mount all its children.
      const focused = elements[focusIdx];
      const focusedFrameId =
        isFrameElement(focused) || isMagicFrameElement(focused)
          ? focused.id
          : focused.frameId;
      if (focusedFrameId) {
        for (const el of elements) {
          if (el.frameId === focusedFrameId) {
            mountedIds.add(el.id);
          }
          if (el.id === focusedFrameId) {
            mountedIds.add(el.id);
          }
        }
      }
    }
  }

  // Build depth-first ordered output.
  //   - Top-level frames: emit frame, then its children in z-order.
  //   - Top-level non-frames: emit directly.
  //   - Skip any not in mountedIds.
  const result: NonDeletedExcalidrawElement[] = [];
  const emittedIds = new Set<string>();

  // Group children by frameId for O(1) lookup. We only build groups for
  // frames that are themselves mounted; ungrouped children retain their
  // global z-order position (they'll be emitted in the top-level pass).
  const mountedFrameIds = new Set<string>();
  for (const el of elements) {
    if (
      mountedIds.has(el.id) &&
      (isFrameElement(el) || isMagicFrameElement(el))
    ) {
      mountedFrameIds.add(el.id);
    }
  }

  const childrenByFrame = new Map<string, NonDeletedExcalidrawElement[]>();
  for (const el of elements) {
    if (
      el.frameId &&
      mountedFrameIds.has(el.frameId) &&
      mountedIds.has(el.id)
    ) {
      let list = childrenByFrame.get(el.frameId);
      if (!list) {
        list = [];
        childrenByFrame.set(el.frameId, list);
      }
      list.push(el);
    }
  }

  for (const el of elements) {
    if (!mountedIds.has(el.id)) {
      continue;
    }
    if (emittedIds.has(el.id)) {
      continue;
    }
    // If this element is a child of a *mounted* frame, skip — it'll be
    // emitted as part of that frame's child block when the frame's turn
    // comes.
    if (el.frameId && mountedFrameIds.has(el.frameId)) {
      continue;
    }

    result.push(el);
    emittedIds.add(el.id);

    if (isFrameElement(el) || isMagicFrameElement(el)) {
      const children = childrenByFrame.get(el.id);
      if (children) {
        for (const child of children) {
          if (!emittedIds.has(child.id)) {
            result.push(child);
            emittedIds.add(child.id);
          }
        }
      }
    }
  }

  return result;
};

/**
 * Strict-equality diff for two mount lists. Returns true if the list of
 * IDs is identical in length and order. Used by the renderer to short-
 * circuit no-op updates. Note: this does *not* check element identity,
 * only the mount set — element field updates (e.g. position changes
 * during drag) are handled by React's normal reconciliation since each
 * treeitem is keyed by element.id and receives the current element as
 * a prop.
 */
export const mountListsEqual = (
  a: readonly NonDeletedExcalidrawElement[],
  b: readonly NonDeletedExcalidrawElement[],
): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) {
      return false;
    }
  }
  return true;
};

// Re-exported for callers who already have OrderedExcalidrawElement[].
export type { OrderedExcalidrawElement };
