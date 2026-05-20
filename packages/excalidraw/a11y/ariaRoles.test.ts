import { API } from "../tests/helpers/api";
import { arrayToMap } from "../utils";
import { t } from "../i18n";

import {
  ELEMENT_MIRROR_ROLE,
  getElementMirrorRole,
  getElementAccessibleName,
  getElementAriaState,
} from "./ariaRoles";

import type { Bounds } from "../element/bounds";
import type { ElementsMap, ExcalidrawElementType } from "../element/types";
import type { AppState } from "../types";

const SCENE: Bounds = [0, 0, 300, 300];

const ALL_TYPES: Exclude<ExcalidrawElementType, "selection">[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "text",
  "line",
  "arrow",
  "freedraw",
  "image",
  "frame",
  "magicframe",
  "embeddable",
  "iframe",
];

describe("getElementMirrorRole", () => {
  it("maps frame-like elements to group and everything else to option", () => {
    for (const type of ALL_TYPES) {
      const el = API.createElement({ type } as any);
      const role = getElementMirrorRole(el);
      if (type === "frame" || type === "magicframe") {
        expect(role).toBe("group");
      } else {
        expect(role).toBe("option");
      }
    }
  });

  it("covers every element type in the source-of-truth map", () => {
    expect(ELEMENT_MIRROR_ROLE.selection).toBe("option");
    for (const type of ALL_TYPES) {
      expect(ELEMENT_MIRROR_ROLE[type]).toBeDefined();
    }
  });
});

describe("getElementAccessibleName", () => {
  const nameFor = (element: any, elements: any[], frame: any = null) =>
    getElementAccessibleName({
      element,
      elementsMap: arrayToMap(elements) as ElementsMap,
      frame,
      sceneBounds: SCENE,
      isRTL: false,
      t,
    });

  it("composes type + position for a plain shape", () => {
    const el = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    expect(nameFor(el, [el])).toBe(
      t("a11y.name.withPosition", {
        name: t("a11y.elementType.rectangle"),
        position: t("a11y.position.topLeft"),
      }),
    );
  });

  it("exposes full text content of text elements", () => {
    const el = API.createElement({
      type: "text",
      text: "Hello world",
      x: 0,
      y: 0,
    });
    const name = nameFor(el, [el]);
    expect(name).toContain("Hello world");
    expect(name).toContain(t("a11y.elementType.text"));
  });

  it("collapses newlines in text content", () => {
    const el = API.createElement({
      type: "text",
      text: "line one\nline two",
      x: 0,
      y: 0,
    });
    expect(nameFor(el, [el])).toContain("line one line two");
  });

  it("uses bound text for a text container", () => {
    const container = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const text = API.createElement({
      type: "text",
      text: "Caption",
      containerId: container.id,
    });
    (container as any).boundElements = [{ type: "text", id: text.id }];
    expect(nameFor(container, [container, text])).toContain("Caption");
  });

  it("names a frame group from its label", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    (frame as any).name = "Diagram";
    expect(nameFor(frame, [frame])).toContain("Diagram");
  });

  it("mirrors the position descriptor under RTL", () => {
    const el = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const name = getElementAccessibleName({
      element: el,
      elementsMap: arrayToMap([el]) as ElementsMap,
      frame: null,
      sceneBounds: SCENE,
      isRTL: true,
      t,
    });
    expect(name).toContain(t("a11y.position.topRight"));
  });
});

describe("getElementAriaState", () => {
  const baseState = (
    overrides: Partial<
      Pick<AppState, "selectedElementIds" | "editingTextElement">
    > = {},
  ): Pick<AppState, "selectedElementIds" | "editingTextElement"> => ({
    selectedElementIds: {},
    editingTextElement: null,
    ...overrides,
  });

  it("reflects selection from appState.selectedElementIds", () => {
    const el = API.createElement({ type: "rectangle" });
    expect(getElementAriaState(el, baseState()).selected).toBe(false);
    expect(
      getElementAriaState(
        el,
        baseState({ selectedElementIds: { [el.id]: true } }),
      ).selected,
    ).toBe(true);
  });

  it("marks locked elements disabled", () => {
    const locked = API.createElement({ type: "rectangle", locked: true });
    const unlocked = API.createElement({ type: "rectangle" });
    expect(getElementAriaState(locked, baseState()).disabled).toBe(true);
    expect(getElementAriaState(unlocked, baseState()).disabled).toBe(false);
  });

  it("marks the element being text-edited as editing", () => {
    const text = API.createElement({ type: "text", text: "hi" });
    expect(
      getElementAriaState(text, baseState({ editingTextElement: text }))
        .editing,
    ).toBe(true);
  });

  it("marks a container whose bound text is being edited as editing", () => {
    const container = API.createElement({ type: "rectangle" });
    const text = API.createElement({
      type: "text",
      text: "hi",
      containerId: container.id,
    });
    expect(
      getElementAriaState(container, baseState({ editingTextElement: text }))
        .editing,
    ).toBe(true);
  });
});
