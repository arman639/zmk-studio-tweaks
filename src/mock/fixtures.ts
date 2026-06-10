import type {
  BehaviorParameterValueDescription,
  GetBehaviorDetailsResponse,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type {
  BehaviorBinding,
  KeyPhysicalAttrs,
  Layer,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { MockKeyboardFixture } from "./device";

// --- HID usage helpers -----------------------------------------------------
// Picker/keycap code encodes a usage as (page << 16) | id; page 7 is the
// Keyboard/Keypad page, which covers everything this fixture needs.
const KB_PAGE = 7;
const hid = (id: number) => (KB_PAGE << 16) | id;

// Just the subset of HID keyboard usage ids this demo keymap references.
const KEY: Record<string, number> = {
  N1: 30, N2: 31, N3: 32, N4: 33, N5: 34, N6: 35, N7: 36, N8: 37, N9: 38, N0: 39,
  A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13,
  K: 14, L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22, T: 23,
  U: 24, V: 25, W: 26, X: 27, Y: 28, Z: 29,
  SEMI: 51, COMMA: 54, DOT: 55, SLASH: 56,
  ENTER: 40, SPACE: 44, TAB: 43, BSPC: 42, ESC: 41,
  QUOTE: 52, GRAVE: 53, MINUS: 45, EQUAL: 46, LBKT: 47, RBKT: 48, BSLH: 49,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66, F10: 67,
  RIGHT: 79, LEFT: 80, DOWN: 81, UP: 82,
  LCTRL: 224, LSHIFT: 225, LALT: 226, LGUI: 227,
  RCTRL: 228, RSHIFT: 229, RALT: 230, RGUI: 231,
};

// --- behavior metadata helpers ---------------------------------------------
const hidParam = (name: string): BehaviorParameterValueDescription => ({
  name,
  hidUsage: { keyboardMax: 0xffff, consumerMax: 0xffff },
});
const layerParam = (name: string): BehaviorParameterValueDescription => ({
  name,
  layerId: {},
});
const constParam = (
  name: string,
  constant: number
): BehaviorParameterValueDescription => ({ name, constant });
const rangeParam = (
  name: string,
  min: number,
  max: number
): BehaviorParameterValueDescription => ({ name, range: { min, max } });

// Behavior ids are arbitrary stable handles, exactly as a real device reports
// them. displayName matches the names the picker classifies on
// (see STANDARD_BEHAVIORS in BehaviorBindingPicker).
const B = {
  keyPress: 1,
  stickyKey: 2,
  capsWord: 3,
  transparent: 4,
  none: 5,
  momentaryLayer: 6,
  layerTap: 7,
  toLayer: 8,
  toggleLayer: 9,
  modTap: 10,
  reset: 11,
  bootloader: 12,
  studioUnlock: 13,
  bluetooth: 14,
  outputSel: 15,
  extPower: 16,
  mouseKeyPress: 17,
  mouseMove: 18,
  mouseScroll: 19,
  keyToggle: 20,
  keyRepeat: 21,
  graveEscape: 22,
  stickyLayer: 23,
  // Firmware-extension (keymap-author-defined) behaviors — not ZMK standards.
  // Each exercises a different "drained residual" route (issue #16): a custom
  // mod-tap (→ Hold mode), a parameterless one (→ Apps/Media/Special), a custom
  // layer-tap (→ Hold mode Layer), and a custom enum (→ the Custom tab).
  homeRowMods: 24,
  numWord: 25,
  layerTap2: 26,
  ledMode: 27,
} as const;

const BEHAVIORS: GetBehaviorDetailsResponse[] = [
  { id: B.keyPress, displayName: "Key Press", metadata: [{ param1: [hidParam("key")], param2: [] }] },
  { id: B.stickyKey, displayName: "Sticky Key", metadata: [{ param1: [hidParam("key")], param2: [] }] },
  { id: B.keyToggle, displayName: "Key Toggle", metadata: [{ param1: [hidParam("key")], param2: [] }] },
  { id: B.capsWord, displayName: "Caps Word", metadata: [] },
  { id: B.keyRepeat, displayName: "Key Repeat", metadata: [] },
  { id: B.graveEscape, displayName: "Grave/Escape", metadata: [] },
  { id: B.transparent, displayName: "Transparent", metadata: [] },
  { id: B.none, displayName: "None", metadata: [] },
  { id: B.momentaryLayer, displayName: "Momentary Layer", metadata: [{ param1: [layerParam("layer")], param2: [] }] },
  { id: B.layerTap, displayName: "Layer-Tap", metadata: [{ param1: [layerParam("layer")], param2: [hidParam("tap")] }] },
  { id: B.toLayer, displayName: "To Layer", metadata: [{ param1: [layerParam("layer")], param2: [] }] },
  { id: B.toggleLayer, displayName: "Toggle Layer", metadata: [{ param1: [layerParam("layer")], param2: [] }] },
  { id: B.stickyLayer, displayName: "Sticky Layer", metadata: [{ param1: [layerParam("layer")], param2: [] }] },
  { id: B.modTap, displayName: "Mod-Tap", metadata: [{ param1: [hidParam("mod")], param2: [hidParam("tap")] }] },
  { id: B.reset, displayName: "Reset", metadata: [] },
  { id: B.bootloader, displayName: "Bootloader", metadata: [] },
  { id: B.studioUnlock, displayName: "Studio Unlock", metadata: [] },
  // Single-action tile behaviors (Step 3a). Metadata shapes mirror what a real
  // keyboard reports: a list of (param1, param2) sets, each with constant or
  // range values the tile grid explodes into one finished binding per value.
  {
    id: B.bluetooth,
    displayName: "Bluetooth",
    metadata: [
      { param1: [constParam("BT_CLR", 0)], param2: [] },
      { param1: [constParam("BT_CLR_ALL", 1)], param2: [] },
      { param1: [constParam("BT_NXT", 2)], param2: [] },
      { param1: [constParam("BT_PRV", 3)], param2: [] },
      { param1: [constParam("BT_SEL", 4)], param2: [rangeParam("profile", 0, 4)] },
    ],
  },
  {
    id: B.outputSel,
    displayName: "Output Selection",
    metadata: [
      {
        param1: [
          constParam("OUT_USB", 0),
          constParam("OUT_BLE", 1),
          constParam("OUT_TOG", 2),
        ],
        param2: [],
      },
    ],
  },
  {
    id: B.extPower,
    displayName: "External Power",
    metadata: [
      {
        param1: [
          constParam("EP_OFF", 0),
          constParam("EP_ON", 1),
          constParam("EP_TOG", 2),
        ],
        param2: [],
      },
    ],
  },
  {
    id: B.mouseKeyPress,
    displayName: "Mouse Key Press",
    metadata: [
      {
        param1: [
          constParam("LCLK", 1),
          constParam("RCLK", 2),
          constParam("MCLK", 4),
        ],
        param2: [],
      },
    ],
  },
  {
    id: B.mouseMove,
    displayName: "Mouse Move",
    metadata: [
      {
        param1: [
          constParam("UP", 0),
          constParam("DOWN", 1),
          constParam("LEFT", 2),
          constParam("RIGHT", 3),
        ],
        param2: [],
      },
    ],
  },
  {
    id: B.mouseScroll,
    displayName: "Mouse Scroll",
    metadata: [
      {
        param1: [
          constParam("UP", 0),
          constParam("DOWN", 1),
          constParam("LEFT", 2),
          constParam("RIGHT", 3),
        ],
        param2: [],
      },
    ],
  },
];

// Firmware-extension behaviors a keymap author might define. Appended to the
// standard set for the split fixture so the residual "More behaviors" escape
// hatch has something to show: a custom hold-tap (param2 hidUsage → classifies
// "Hold-Tap", not tileable) and a parameterless custom behavior (→ "Other").
const CUSTOM_BEHAVIORS: GetBehaviorDetailsResponse[] = [
  // Custom mod-tap (→ Hold mode, Mod-Tap identity).
  {
    id: B.homeRowMods,
    displayName: "Home Row Mods",
    metadata: [{ param1: [hidParam("mod")], param2: [hidParam("tap")] }],
  },
  // Parameterless custom (→ Apps/Media/Special special tile).
  { id: B.numWord, displayName: "Num Word", metadata: [] },
  // Custom layer-tap, same shape as &lt (→ Hold mode, Layer-Tap identity).
  {
    id: B.layerTap2,
    displayName: "Balanced LT",
    metadata: [{ param1: [layerParam("layer")], param2: [hidParam("tap")] }],
  },
  // Custom enum behavior with no known strip group (→ the Custom tab).
  {
    id: B.ledMode,
    displayName: "LED Mode",
    metadata: [
      {
        param1: [
          constParam("OFF", 0),
          constParam("DIM", 1),
          constParam("BRIGHT", 2),
        ],
        param2: [],
      },
    ],
  },
];

// --- binding builders ------------------------------------------------------
const bind = (behaviorId: number, param1 = 0, param2 = 0): BehaviorBinding => ({
  behaviorId,
  param1,
  param2,
});
const kp = (name: string) => bind(B.keyPress, hid(KEY[name]));
const trans = () => bind(B.transparent);
const none = () => bind(B.none);

const FN_LAYER_ID = 1;

// --- physical layout -------------------------------------------------------
// A plain 10x5 ortho grid. Physical attrs are in centi-key-units (the app
// divides by 100), so 1u == 100.
const COLS = 10;
const ROWS = 5;
const UNIT = 100;
const ORTHO_KEYS: KeyPhysicalAttrs[] = Array.from(
  { length: COLS * ROWS },
  (_, i) => ({
    width: UNIT,
    height: UNIT,
    x: (i % COLS) * UNIT,
    y: Math.floor(i / COLS) * UNIT,
    r: 0,
    rx: 0,
    ry: 0,
  })
);

// --- layers ----------------------------------------------------------------
// Base layer: number row, three letter rows, and a thumb row that deliberately
// showcases one of each behaviour family so the picker has something to land on.
const baseBindings: BehaviorBinding[] = [
  kp("N1"), kp("N2"), kp("N3"), kp("N4"), kp("N5"), kp("N6"), kp("N7"), kp("N8"), kp("N9"), kp("N0"),
  kp("Q"), kp("W"), kp("E"), kp("R"), kp("T"), kp("Y"), kp("U"), kp("I"), kp("O"), kp("P"),
  kp("A"), kp("S"), kp("D"), kp("F"), kp("G"), kp("H"), kp("J"), kp("K"), kp("L"), kp("SEMI"),
  kp("Z"), kp("X"), kp("C"), kp("V"), kp("B"), kp("N"), kp("M"), kp("COMMA"), kp("DOT"), kp("SLASH"),
  bind(B.momentaryLayer, FN_LAYER_ID),
  bind(B.layerTap, FN_LAYER_ID, hid(KEY.SPACE)),
  bind(B.modTap, hid(KEY.LSHIFT), hid(KEY.ENTER)),
  bind(B.stickyKey, hid(KEY.LCTRL)),
  bind(B.capsWord),
  trans(),
  none(),
  bind(B.toLayer, FN_LAYER_ID),
  bind(B.toggleLayer, FN_LAYER_ID),
  bind(B.reset),
];

// Fn layer: F-row, an inverted-T arrow cluster, transparent everywhere else.
const fnBindings: BehaviorBinding[] = [
  kp("F1"), kp("F2"), kp("F3"), kp("F4"), kp("F5"), kp("F6"), kp("F7"), kp("F8"), kp("F9"), kp("F10"),
  trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), kp("LEFT"), kp("DOWN"), kp("UP"), kp("RIGHT"), trans(), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(), trans(),
];

const layers: Layer[] = [
  { id: 0, name: "Base", bindings: baseBindings },
  { id: FN_LAYER_ID, name: "Fn", bindings: fnBindings },
];

export const DEMO_ORTHO_50: MockKeyboardFixture = {
  id: "demo-ortho-50",
  label: "Demo · 50-key ortho",
  deviceName: "Mock Ortho 50",
  serialNumber: "MOCK-ORTHO-0001",
  behaviors: BEHAVIORS,
  physicalLayouts: [{ name: "Ortho 10x5", keys: ORTHO_KEYS }],
  activeLayoutIndex: 0,
  layers,
  maxLayers: 8,
  maxLayerNameLength: 16,
};

// ===========================================================================
// Split fixture: a Corne-style 3x6+3 (42-key) split, carrying the custom
// behaviors so the residual "More behaviors" escape hatch can be exercised on a
// realistic ergo board.
// ===========================================================================

// Per-column vertical stagger (key units) for one half, rendered outer→inner so
// the middle finger's column sits highest. The right half mirrors it.
const L_STAGGER = [0.35, 0.35, 0.0, 0.1, 0.25, 0.25];
const R_STAGGER = [...L_STAGGER].reverse();
const SPLIT_GAP_X = 8; // left half is x 0..5; the right half starts here.

const splitKey = (x: number, y: number): KeyPhysicalAttrs => ({
  width: UNIT,
  height: UNIT,
  x: Math.round(x * UNIT),
  y: Math.round(y * UNIT),
  r: 0,
  rx: 0,
  ry: 0,
});

// Key order (matches the binding arrays below): for each of the 3 rows, the six
// left keys then the six right keys; then the left thumb trio, then the right.
const CORNE_KEYS: KeyPhysicalAttrs[] = [];
for (let row = 0; row < 3; row++) {
  for (let c = 0; c < 6; c++) CORNE_KEYS.push(splitKey(c, row + L_STAGGER[c]));
  for (let c = 0; c < 6; c++)
    CORNE_KEYS.push(splitKey(SPLIT_GAP_X + c, row + R_STAGGER[c]));
}
const L_THUMBS: Array<[number, number]> = [
  [3.2, 3.4],
  [4.2, 3.65],
  [5.2, 3.9],
];
const R_THUMBS: Array<[number, number]> = [
  [SPLIT_GAP_X - 0.2, 3.9],
  [SPLIT_GAP_X + 0.8, 3.65],
  [SPLIT_GAP_X + 1.8, 3.4],
];
for (const [x, y] of [...L_THUMBS, ...R_THUMBS]) CORNE_KEYS.push(splitKey(x, y));

// --- split layers ----------------------------------------------------------
const LOWER_ID = 1;
const RAISE_ID = 2;
const mo = (layer: number) => bind(B.momentaryLayer, layer);
// A home-row mod: hold for `mod`, tap for `key` (the custom hold-tap).
const hrm = (mod: string, key: string) =>
  bind(B.homeRowMods, hid(KEY[mod]), hid(KEY[key]));

// Base: QWERTY with home-row mods, layer thumbs, and the two custom behaviors
// (Home Row Mods on the home row, Num Word on the right thumb) so they show on
// real keys — and in the residual picker — without hunting.
const corneBase: BehaviorBinding[] = [
  // row 0
  kp("TAB"), kp("Q"), kp("W"), kp("E"), kp("R"), kp("T"),
  kp("Y"), kp("U"), kp("I"), kp("O"), kp("P"), kp("BSPC"),
  // row 1 (home row: GUI/ALT/CTRL/SHIFT mods under A S D F · J K L ;). G is a
  // custom layer-tap (hold → Raise, tap → G) to exercise the Layer-Tap identity.
  kp("ESC"), hrm("LGUI", "A"), hrm("LALT", "S"), hrm("LCTRL", "D"), hrm("LSHIFT", "F"), bind(B.layerTap2, RAISE_ID, hid(KEY.G)),
  kp("H"), hrm("RSHIFT", "J"), hrm("RCTRL", "K"), hrm("RALT", "L"), hrm("RGUI", "SEMI"), kp("QUOTE"),
  // row 2 (B is a custom enum behavior — LED Mode = BRIGHT — to show the Custom tab)
  kp("LSHIFT"), kp("Z"), kp("X"), kp("C"), kp("V"), bind(B.ledMode, 2),
  kp("N"), kp("M"), kp("COMMA"), kp("DOT"), kp("SLASH"), kp("RSHIFT"),
  // thumbs (L: GUI / Lower / Space · R: Enter / Raise / Num Word)
  kp("LGUI"), mo(LOWER_ID), kp("SPACE"),
  kp("ENTER"), mo(RAISE_ID), bind(B.numWord),
];

// Lower: number row + symbols, transparent elsewhere.
const corneLower: BehaviorBinding[] = [
  kp("GRAVE"), kp("N1"), kp("N2"), kp("N3"), kp("N4"), kp("N5"),
  kp("N6"), kp("N7"), kp("N8"), kp("N9"), kp("N0"), kp("BSPC"),
  trans(), trans(), trans(), trans(), trans(), trans(),
  kp("MINUS"), kp("EQUAL"), kp("LBKT"), kp("RBKT"), kp("BSLH"), kp("QUOTE"),
  trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(),
];

// Raise: function row + an inverted-T arrow cluster, transparent elsewhere.
const corneRaise: BehaviorBinding[] = [
  kp("TAB"), kp("F1"), kp("F2"), kp("F3"), kp("F4"), kp("F5"),
  kp("F6"), kp("F7"), kp("F8"), kp("F9"), kp("F10"), kp("BSPC"),
  trans(), trans(), trans(), trans(), trans(), trans(),
  kp("LEFT"), kp("DOWN"), kp("UP"), kp("RIGHT"), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), trans(), trans(), trans(),
];

const corneLayers: Layer[] = [
  { id: 0, name: "Base", bindings: corneBase },
  { id: LOWER_ID, name: "Lower", bindings: corneLower },
  { id: RAISE_ID, name: "Raise", bindings: corneRaise },
];

export const DEMO_CORNE: MockKeyboardFixture = {
  id: "demo-corne-42",
  label: "Demo · 42-key split (custom behaviors)",
  deviceName: "Mock Corne 42",
  serialNumber: "MOCK-CORNE-0001",
  behaviors: [...BEHAVIORS, ...CUSTOM_BEHAVIORS],
  physicalLayouts: [{ name: "Corne 3x6+3", keys: CORNE_KEYS }],
  activeLayoutIndex: 0,
  layers: corneLayers,
  maxLayers: 8,
  maxLayerNameLength: 16,
};

/** All demo keyboards offered in the connect dialog. */
export const MOCK_FIXTURES: MockKeyboardFixture[] = [DEMO_ORTHO_50, DEMO_CORNE];
