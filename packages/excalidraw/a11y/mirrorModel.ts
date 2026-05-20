import { getElementBounds, getElementAbsoluteCoords } from "../element/bounds";
import { isTextElement, isFrameLikeElement } from "../element/typeChecks";

import type { SpatialItem } from "./spatialNavigation";
import type { Bounds } from "../element/bounds";
import type { ElementsMap, ExcalidrawElement } from "../element/types";
import type { AppState } from "../types";

/**
 * A node in the mirror's accessibility tree. Only frame-like elements have
 * children (their nested options); every other element is a leaf.
 */
export type MirrorNode = {
  id: string;
  element: ExcalidrawElement;
  isFrame: boolean;
  children: MirrorNode[];
};

export type MirrorModel = {
  /** top-level nodes in z-order; frames nest their children */
  tree: MirrorNode[];
  /** flattened pre-order tab sequence of navigable element ids */
  order: string[];
  /** the set of element ids that should actually be mounted in the DOM */
  mounted: Set<string>;
};

/**
 * Whether an element should appear in the mirror at all (as a focusable option
 * or as a frame group). Selection helpers and bound text are excluded — bound
 * text is folded into its container's accessible name.
 */
export const isMirrorNavigable = (element: ExcalidrawElement): boolean => {
  if (element.isDeleted) {
    return false;
  }
  if (element.type === "selection") {
    return false;
  }
  if (isTextElement(element) && element.containerId) {
    return false;
  }
  return true;
};

/**
 * Whether an element is a focusable/selectable mirror node (an `option`).
 * Frame-like elements are exposed as ARIA `group`s (containers) rather than
 * focusable options, so they are excluded from the tab order and from spatial
 * navigation; navigation moves among their child elements instead.
 */
export const isMirrorFocusable = (element: ExcalidrawElement): boolean =>
  isMirrorNavigable(element) && !isFrameLikeElement(element);

const boundsIntersect = (a: Bounds, b: Bounds): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * Builds the mirror tree, tab order, and the virtualized mount set.
 *
 * Mounted = (elements intersecting the viewport)
 *         ∪ (the focused element + one z-order neighbor on each side)
 *         ∪ (every child of the focused frame, when focus is inside a frame)
 *         ∪ (selected elements, so selection state is never lost off-screen)
 *
 * O(n) over the element list; bounds are read through the memoized
 * `getElementBounds`, so re-running on every scene change stays cheap.
 */
export const buildMirrorModel = ({
  elements,
  elementsMap,
  selectedElementIds,
  focusedElementId,
  viewportBounds,
}: {
  /** non-deleted elements in z-order */
  elements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  selectedElementIds: AppState["selectedElementIds"];
  focusedElementId: string | null;
  /** visible canvas rect in scene coordinates, or null to skip viewport mounting */
  viewportBounds: Bounds | null;
}): MirrorModel => {
  const navigable = elements.filter(isMirrorNavigable);
  const navigableIds = new Set(navigable.map((element) => element.id));

  const frameIds = new Set(
    navigable.filter(isFrameLikeElement).map((frame) => frame.id),
  );

  const childrenByFrame = new Map<string, ExcalidrawElement[]>();
  const topLevel: ExcalidrawElement[] = [];

  for (const element of navigable) {
    if (element.frameId && frameIds.has(element.frameId)) {
      const siblings = childrenByFrame.get(element.frameId) ?? [];
      siblings.push(element);
      childrenByFrame.set(element.frameId, siblings);
    } else {
      topLevel.push(element);
    }
  }

  const tree: MirrorNode[] = topLevel.map((element) => {
    if (isFrameLikeElement(element)) {
      const children: MirrorNode[] = (
        childrenByFrame.get(element.id) ?? []
      ).map((child) => ({
        id: child.id,
        element: child,
        isFrame: false,
        children: [],
      }));
      return { id: element.id, element, isFrame: true, children };
    }
    return { id: element.id, element, isFrame: false, children: [] };
  });

  // pre-order flatten of *focusable* nodes only (frames are non-focusable
  // groups). Frame children come right after their frame's position, before
  // the next top-level sibling — matching the required z-order tab sequence.
  const order: string[] = [];
  for (const node of tree) {
    if (!node.isFrame) {
      order.push(node.id);
    }
    for (const child of node.children) {
      order.push(child.id);
    }
  }

  const mounted = new Set<string>();

  // 1. viewport-intersecting elements
  if (viewportBounds) {
    for (const element of navigable) {
      if (
        boundsIntersect(getElementBounds(element, elementsMap), viewportBounds)
      ) {
        mounted.add(element.id);
      }
    }
  }

  // 2. selected elements (keep selection state present even when off-screen)
  for (const id in selectedElementIds) {
    if (selectedElementIds[id] && navigableIds.has(id)) {
      mounted.add(id);
    }
  }

  // 3. focused element + one z-order neighbor on each side
  if (focusedElementId && navigableIds.has(focusedElementId)) {
    const index = order.indexOf(focusedElementId);
    if (index !== -1) {
      mounted.add(order[index]);
      if (index > 0) {
        mounted.add(order[index - 1]);
      }
      if (index < order.length - 1) {
        mounted.add(order[index + 1]);
      }
    }

    // 4. every child of the focused frame (whether focus is on the frame or
    // on one of its children)
    const focusedElement = elementsMap.get(focusedElementId);
    const focusedFrameId =
      focusedElement && isFrameLikeElement(focusedElement)
        ? focusedElement.id
        : focusedElement?.frameId ?? null;

    if (focusedFrameId && frameIds.has(focusedFrameId)) {
      mounted.add(focusedFrameId);
      for (const child of childrenByFrame.get(focusedFrameId) ?? []) {
        mounted.add(child.id);
      }
    }
  }

  // 5. a mounted child cannot render without its frame group ancestor
  for (const id of [...mounted]) {
    const element = elementsMap.get(id);
    if (element?.frameId && frameIds.has(element.frameId)) {
      mounted.add(element.frameId);
    }
  }

  return { tree, order, mounted };
};

/**
 * Builds the spatial-navigation items (id + centroid) for all navigable
 * elements. Computed on demand (on arrow keypress) rather than every render,
 * so the per-frame mirror update stays within budget on large scenes.
 */
export const buildSpatialItems = (
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): SpatialItem[] =>
  elements.filter(isMirrorFocusable).map((element) => {
    const [, , , , cx, cy] = getElementAbsoluteCoords(element, elementsMap);
    return { id: element.id, center: { x: cx, y: cy } };
  });
