import { describe, expect, it } from "vitest";

import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import { isTileable, tileBindingsFor } from "./tiles";

const behavior = (
  id: number,
  displayName: string,
  metadata: GetBehaviorDetailsResponse["metadata"]
): GetBehaviorDetailsResponse => ({ id, displayName, metadata });

describe("tileBindingsFor", () => {
  it("makes a single tile for a parameterless behavior (empty metadata)", () => {
    const reset = behavior(11, "Reset", []);
    expect(tileBindingsFor(reset)).toEqual([
      { label: "Reset", binding: { behaviorId: 11, param1: 0, param2: 0 } },
    ]);
  });

  it("makes a single tile for a behavior whose set has no params", () => {
    const capsWord = behavior(3, "Caps Word", [{ param1: [], param2: [] }]);
    expect(tileBindingsFor(capsWord)).toEqual([
      { label: "Caps Word", binding: { behaviorId: 3, param1: 0, param2: 0 } },
    ]);
  });

  it("makes one tile per constant value (Output-style)", () => {
    const out = behavior(20, "Output Selection", [
      {
        param1: [
          { name: "USB", constant: 0 },
          { name: "BLE", constant: 1 },
          { name: "Toggle", constant: 2 },
        ],
        param2: [],
      },
    ]);
    expect(tileBindingsFor(out)).toEqual([
      { label: "USB", binding: { behaviorId: 20, param1: 0, param2: 0 } },
      { label: "BLE", binding: { behaviorId: 20, param1: 1, param2: 0 } },
      { label: "Toggle", binding: { behaviorId: 20, param1: 2, param2: 0 } },
    ]);
  });

  it("explodes a range param into one tile per value (Bluetooth profiles)", () => {
    // BT_SEL takes a profile index range; BT_CLR takes no profile. Two sets.
    const bt = behavior(21, "Bluetooth", [
      {
        param1: [{ name: "BT_SEL", constant: 0 }],
        param2: [{ name: "profile", range: { min: 0, max: 2 } }],
      },
      { param1: [{ name: "BT_CLR", constant: 1 }], param2: [] },
    ]);
    expect(tileBindingsFor(bt)).toEqual([
      { label: "BT_SEL 0", binding: { behaviorId: 21, param1: 0, param2: 0 } },
      { label: "BT_SEL 1", binding: { behaviorId: 21, param1: 0, param2: 1 } },
      { label: "BT_SEL 2", binding: { behaviorId: 21, param1: 0, param2: 2 } },
      { label: "BT_CLR", binding: { behaviorId: 21, param1: 1, param2: 0 } },
    ]);
  });

  it("treats a nil param as a single zero-valued tile", () => {
    const b = behavior(30, "Nilly", [
      { param1: [{ name: "n", nil: {} }], param2: [] },
    ]);
    expect(tileBindingsFor(b)).toEqual([
      { label: "Nilly", binding: { behaviorId: 30, param1: 0, param2: 0 } },
    ]);
  });

  it("returns null for a behavior with a HID-key param (Sticky Key)", () => {
    const sk = behavior(2, "Sticky Key", [
      {
        param1: [
          { name: "key", hidUsage: { keyboardMax: 0xffff, consumerMax: 0xffff } },
        ],
        param2: [],
      },
    ]);
    expect(tileBindingsFor(sk)).toBeNull();
    expect(isTileable(sk)).toBe(false);
  });

  it("returns null for a behavior with a layer param (To Layer)", () => {
    const toLayer = behavior(8, "To Layer", [
      { param1: [{ name: "layer", layerId: {} }], param2: [] },
    ]);
    expect(tileBindingsFor(toLayer)).toBeNull();
  });

  it("returns null when only the second param needs a picker (Mod-Tap)", () => {
    const mt = behavior(10, "Mod-Tap", [
      {
        param1: [
          { name: "mod", hidUsage: { keyboardMax: 0xffff, consumerMax: 0xffff } },
        ],
        param2: [
          { name: "tap", hidUsage: { keyboardMax: 0xffff, consumerMax: 0xffff } },
        ],
      },
    ]);
    expect(tileBindingsFor(mt)).toBeNull();
  });

  it("reports tile-able behaviors via isTileable", () => {
    expect(isTileable(behavior(11, "Reset", []))).toBe(true);
  });
});
