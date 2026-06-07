import { describe, expect, it } from "vitest";

import { formatBinding } from "./parameters";
import { formatBindingParam } from "../keymap-parser";
import { DEMO_ORTHO_50 } from "../mock/fixtures";

const behaviors = DEMO_ORTHO_50.behaviors;
const layerIds = DEMO_ORTHO_50.layers.map((l) => l.id);
const by = (name: string) => behaviors.find((b) => b.displayName === name)!;
const hid = (id: number) => (7 << 16) | id;

describe("formatBinding", () => {
  it("renders a key press with its keycode name", () => {
    const kp = by("Key Press");
    expect(
      formatBinding({ behaviorId: kp.id, param1: hid(4), param2: 0 }, kp, layerIds)
    ).toBe(`&kp ${formatBindingParam(hid(4))}`);
  });

  it("renders mod-tap with both params in order", () => {
    const mt = by("Mod-Tap");
    const binding = { behaviorId: mt.id, param1: hid(0xe1), param2: hid(0x28) };
    expect(formatBinding(binding, mt, layerIds)).toBe(
      `&mt ${formatBindingParam(hid(0xe1))} ${formatBindingParam(hid(0x28))}`
    );
  });

  it("renders a momentary layer with a layer index", () => {
    const mo = by("Momentary Layer");
    expect(
      formatBinding({ behaviorId: mo.id, param1: 1, param2: 0 }, mo, layerIds)
    ).toBe("&mo 1");
  });

  it("renders layer-tap with a layer index and a tap key", () => {
    const lt = by("Layer-Tap");
    expect(
      formatBinding({ behaviorId: lt.id, param1: 1, param2: hid(0x28) }, lt, layerIds)
    ).toBe(`&lt 1 ${formatBindingParam(hid(0x28))}`);
  });

  it("renders a parameterless behavior bare", () => {
    const none = by("None");
    const reset = by("Reset");
    expect(formatBinding({ behaviorId: none.id, param1: 0, param2: 0 }, none, layerIds)).toBe("&none");
    expect(formatBinding({ behaviorId: reset.id, param1: 0, param2: 0 }, reset, layerIds)).toBe("&reset");
  });

  it("uses the metadata constant name and emits param2 only when the set has it", () => {
    const bt = by("Bluetooth");
    // BT_SEL (constant 4) takes a profile; BT_CLR (constant 0) does not.
    expect(formatBinding({ behaviorId: bt.id, param1: 4, param2: 2 }, bt, layerIds)).toBe("&bt BT_SEL 2");
    expect(formatBinding({ behaviorId: bt.id, param1: 0, param2: 0 }, bt, layerIds)).toBe("&bt BT_CLR");
  });

  it("returns an empty string for an unknown behavior", () => {
    expect(formatBinding({ behaviorId: 999, param1: 0, param2: 0 }, undefined, layerIds)).toBe("");
  });
});
