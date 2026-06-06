import { describe, expect, it } from "vitest";

import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

import {
  bindingToSlots,
  buildDerivationRegistry,
  deriveBinding,
  isModifierUsage,
  type Slots,
} from "./slots";
import { validateBinding } from "./parameters";
import { DEMO_ORTHO_50 } from "../mock/fixtures";

// The demo fixture exposes exactly the four core behaviors + None, with the same
// metadata shapes a real keyboard reports, so it's the natural ground truth.
const behaviors = DEMO_ORTHO_50.behaviors;
const reg = buildDerivationRegistry(behaviors);
const layerIds = DEMO_ORTHO_50.layers.map((l) => l.id);

const idOf = (displayName: string) =>
  behaviors.find((b) => b.displayName === displayName)!.id;
const KP = idOf("Key Press");
const MT = idOf("Mod-Tap");
const LT = idOf("Layer-Tap");
const MO = idOf("Momentary Layer");
const NONE = idOf("None");

// HID usage encoding: (page << 16) | id, with implicit modifiers in the high
// byte. Page 7 is the Keyboard/Keypad page.
const hid = (id: number) => (7 << 16) | id;
const KEY_A = hid(4);
const KEY_ENTER = hid(40);
const KEY_SPACE = hid(44);
const KEY_N1 = hid(30);
const LSHIFT = hid(225);
const LCTRL = hid(224);
const FN_LAYER = 1;
// Modifier wrappers pack a bit into the high byte (see keymap-parser).
const LC = (usage: number) => usage | (0x01 << 24);
const LS = (usage: number) => usage | (0x02 << 24);

describe("buildDerivationRegistry", () => {
  it("resolves every core behavior id the firmware exposes", () => {
    expect(reg.idByCore).toEqual({
      kp: KP,
      mt: MT,
      lt: LT,
      mo: MO,
      none: NONE,
    });
    expect(reg.coreById.get(MT)).toBe("mt");
    expect(reg.coreById.get(NONE)).toBe("none");
  });

  it("omits core behaviors the firmware does not expose (capability-aware)", () => {
    const partial = buildDerivationRegistry(
      behaviors.filter((b) => b.displayName !== "Mod-Tap")
    );
    expect(partial.idByCore.mt).toBeUndefined();
    expect(partial.idByCore.kp).toBe(KP);
  });
});

describe("isModifierUsage", () => {
  it("recognises the eight base HID modifier usages", () => {
    for (let id = 0xe0; id <= 0xe7; id++) {
      expect(isModifierUsage(hid(id)), `usage 0x${id.toString(16)}`).toBe(true);
    }
  });

  it("recognises a multi-modifier hold whose base is a modifier", () => {
    // LC(LSHFT) = hold Ctrl+Shift. The LC bit lives in the high byte; matching
    // the raw value against the eight usages would miss it (design note §4).
    expect(isModifierUsage(LC(LSHIFT))).toBe(true);
    expect(isModifierUsage(LS(LCTRL))).toBe(true);
  });

  it("treats a shifted key as a key, not a modifier", () => {
    // LS(N1) = "!" — carries a mod bit but its base (N1) is a regular key, so it
    // belongs in the Tap slot.
    expect(isModifierUsage(LS(KEY_N1))).toBe(false);
    expect(isModifierUsage(KEY_A)).toBe(false);
  });

  it("does not treat layer ids / small immediates as modifiers", () => {
    expect(isModifierUsage(0)).toBe(false);
    expect(isModifierUsage(FN_LAYER)).toBe(false);
  });
});

describe("deriveBinding — the §2 table", () => {
  const cases: [name: string, slots: Slots, expected: BehaviorBinding][] = [
    [
      "key tap, empty hold → &kp <key>",
      { tap: { kind: "key", usage: KEY_A }, hold: { kind: "empty" } },
      { behaviorId: KP, param1: KEY_A, param2: 0 },
    ],
    [
      "key tap, mod hold → &mt <mod> <key>",
      { tap: { kind: "key", usage: KEY_ENTER }, hold: { kind: "mod", usage: LSHIFT } },
      { behaviorId: MT, param1: LSHIFT, param2: KEY_ENTER },
    ],
    [
      "key tap, layer hold → &lt <layer> <key>",
      { tap: { kind: "key", usage: KEY_SPACE }, hold: { kind: "layer", layerId: FN_LAYER } },
      { behaviorId: LT, param1: FN_LAYER, param2: KEY_SPACE },
    ],
    [
      "empty tap, layer hold → &mo <layer>",
      { tap: { kind: "empty" }, hold: { kind: "layer", layerId: FN_LAYER } },
      { behaviorId: MO, param1: FN_LAYER, param2: 0 },
    ],
    [
      "empty tap, mod hold → &kp <mod>",
      { tap: { kind: "empty" }, hold: { kind: "mod", usage: LSHIFT } },
      { behaviorId: KP, param1: LSHIFT, param2: 0 },
    ],
    [
      "empty tap, empty hold → &none",
      { tap: { kind: "empty" }, hold: { kind: "empty" } },
      { behaviorId: NONE, param1: 0, param2: 0 },
    ],
  ];

  it.each(cases)("%s", (_name, slots, expected) => {
    expect(deriveBinding(slots, reg)).toEqual(expected);
  });

  it("every derived binding passes the firmware-facing validateBinding", () => {
    for (const [name, slots] of cases) {
      const binding = deriveBinding(slots, reg)!;
      const metadata = behaviors.find((b) => b.id === binding.behaviorId)!
        .metadata!;
      expect(
        validateBinding(metadata, layerIds, binding.param1, binding.param2),
        name
      ).toBe(true);
    }
  });

  it("returns null when the firmware doesn't expose the derived behavior", () => {
    const noMt = buildDerivationRegistry(
      behaviors.filter((b) => b.displayName !== "Mod-Tap")
    );
    const slots: Slots = {
      tap: { kind: "key", usage: KEY_A },
      hold: { kind: "mod", usage: LSHIFT },
    };
    expect(deriveBinding(slots, noMt)).toBeNull();
  });
});

describe("bindingToSlots", () => {
  it("reads a lone-modifier &kp into the Hold slot", () => {
    expect(bindingToSlots({ behaviorId: KP, param1: LSHIFT, param2: 0 }, reg)).toEqual(
      { tap: { kind: "empty" }, hold: { kind: "mod", usage: LSHIFT } }
    );
  });

  it("reads a regular-key &kp into the Tap slot", () => {
    expect(bindingToSlots({ behaviorId: KP, param1: KEY_A, param2: 0 }, reg)).toEqual(
      { tap: { kind: "key", usage: KEY_A }, hold: { kind: "empty" } }
    );
  });

  it("returns null for behaviors outside the derivable core", () => {
    const stickyKey = idOf("Sticky Key");
    expect(bindingToSlots({ behaviorId: stickyKey, param1: LCTRL, param2: 0 }, reg)).toBeNull();
  });
});

describe("round trip — binding-lossless for every core behavior", () => {
  const bindings: [name: string, binding: BehaviorBinding][] = [
    ["&kp A", { behaviorId: KP, param1: KEY_A, param2: 0 }],
    ["&kp LSHIFT (held modifier)", { behaviorId: KP, param1: LSHIFT, param2: 0 }],
    ["&kp LS(N1) (shifted key stays a key)", { behaviorId: KP, param1: LS(KEY_N1), param2: 0 }],
    ["&mt LSHIFT ENTER", { behaviorId: MT, param1: LSHIFT, param2: KEY_ENTER }],
    ["&mt LC(LSHFT) A (multi-modifier hold)", { behaviorId: MT, param1: LC(LSHIFT), param2: KEY_A }],
    ["&lt FN SPACE", { behaviorId: LT, param1: FN_LAYER, param2: KEY_SPACE }],
    ["&mo FN", { behaviorId: MO, param1: FN_LAYER, param2: 0 }],
    ["&none", { behaviorId: NONE, param1: 0, param2: 0 }],
  ];

  it.each(bindings)("%s survives binding → slots → binding", (_name, binding) => {
    const slots = bindingToSlots(binding, reg);
    expect(slots).not.toBeNull();
    expect(deriveBinding(slots!, reg)).toEqual(binding);
  });
});
