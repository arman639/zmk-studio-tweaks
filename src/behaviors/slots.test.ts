import { describe, expect, it } from "vitest";

import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";

import {
  bindingToSlots,
  buildDerivationRegistry,
  deriveBinding,
  modifierSetFromUsage,
  usageFromModifierSet,
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

describe("modifier set <-> usage (implicit-modifier encoding)", () => {
  it("decodes a single base modifier", () => {
    expect(modifierSetFromUsage(LCTRL)).toBe(0x01);
    expect(modifierSetFromUsage(LSHIFT)).toBe(0x02);
  });

  it("decodes a multi-modifier hold (base usage + implicit bits)", () => {
    // LC(LSHFT) = Ctrl+Shift: the LC bit is in the high byte, the Shift base in
    // the low bits — both must be picked up so the hold round-trips (design §4).
    expect(modifierSetFromUsage(LC(LSHIFT))).toBe(0x01 | 0x02);
    expect(modifierSetFromUsage(LS(LCTRL))).toBe(0x01 | 0x02);
  });

  it("encodes the empty set as no modifier", () => {
    expect(usageFromModifierSet(0)).toBe(0);
  });

  it("round-trips every modifier subset through usage and back", () => {
    for (let bits = 0; bits <= 0xff; bits++) {
      expect(
        modifierSetFromUsage(usageFromModifierSet(bits)),
        `bits 0x${bits.toString(16)}`
      ).toBe(bits);
    }
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
  it("reads a lone-modifier &kp into the Tap slot (it's just a key)", () => {
    // &kp LSHIFT is a normal Shift key, not the hold half of a Mod-Tap, so it
    // lands in Tap — the Hold modifier mode is reserved for Mod-Tap.
    expect(bindingToSlots({ behaviorId: KP, param1: LSHIFT, param2: 0 }, reg)).toEqual(
      { tap: { kind: "key", usage: LSHIFT }, hold: { kind: "empty" } }
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
    ["&kp LSHIFT (lone modifier is a Tap key)", { behaviorId: KP, param1: LSHIFT, param2: 0 }],
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
