import React from "react";

import {
  render,
  act,
  fireEvent,
  mockBoundingClientRect,
  restoreOriginalGetBoundingClientRect,
  unmountComponent,
} from "./test-utils";
import { Excalidraw } from "../index";
import { API } from "./helpers/api";
import { KEYS } from "../keys";
import { setLanguage, defaultLang } from "../i18n";

import type { Language } from "../i18n";

const ARABIC: Language = { code: "ar-SA", label: "العربية", rtl: true };

const MIRROR = ".excalidraw__a11y-mirror";
const LIVE = ".excalidraw__a11y-live";
const getOption = (id: string) =>
  document.querySelector(
    `${MIRROR} [data-element-id="${id}"]`,
  ) as HTMLElement | null;

unmountComponent();

describe("accessibility mirror — RTL", () => {
  beforeEach(async () => {
    mockBoundingClientRect({ width: 1920, height: 1080 });
    await render(<Excalidraw />);
    await act(async () => {
      await setLanguage(ARABIC);
    });
  });

  afterEach(async () => {
    await act(async () => {
      await setLanguage(defaultLang);
    });
    unmountComponent();
    restoreOriginalGetBoundingClientRect();
  });

  it("sets the document direction to rtl", () => {
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("mirrors spatial navigation: ArrowRight moves to the visually-left element", () => {
    const left = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    }); // center 25
    const middle = API.createElement({
      type: "rectangle",
      x: 200,
      y: 0,
      width: 50,
      height: 50,
    }); // center 225
    const right = API.createElement({
      type: "rectangle",
      x: 400,
      y: 0,
      width: 50,
      height: 50,
    }); // center 425
    API.setElements([left, middle, right]);

    // under RTL, ArrowRight follows reading order and moves to the (nearest)
    // element on the visual left
    getOption(middle.id)!.focus();
    fireEvent.keyDown(getOption(middle.id)!, { key: KEYS.ARROW_RIGHT });
    expect(document.activeElement).toBe(getOption(left.id));

    // ArrowLeft moves to the (nearest) element on the visual right
    getOption(middle.id)!.focus();
    fireEvent.keyDown(getOption(middle.id)!, { key: KEYS.ARROW_LEFT });
    expect(document.activeElement).toBe(getOption(right.id));
  });

  it("mirrors the relative-position descriptor in accessible names", () => {
    const left = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    const right = API.createElement({
      type: "rectangle",
      x: 400,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([left, right]);

    // the visually-left element is described with the (mirrored) "right"
    // descriptor — يمين means "right" in Arabic
    expect(getOption(left.id)!.textContent).toContain("يمين");
    // the visually-right element is described with the "left" descriptor —
    // يسار means "left"
    expect(getOption(right.id)!.textContent).toContain("يسار");
  });

  it("announces in the active locale (Arabic)", () => {
    const a = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
    API.setElements([a]);

    const node = getOption(a.id)!;
    node.focus();
    fireEvent.keyDown(node, { key: KEYS.ENTER });

    const live = document.querySelector(LIVE) as HTMLElement;
    // "تم تحديد" = "Selected" in Arabic
    expect(live.textContent).toContain("تم تحديد");
  });
});
