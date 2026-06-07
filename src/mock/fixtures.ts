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
  ENTER: 40, SPACE: 44,
  F1: 58, F2: 59, F3: 60, F4: 61, F5: 62, F6: 63, F7: 64, F8: 65, F9: 66, F10: 67,
  RIGHT: 79, LEFT: 80, DOWN: 81, UP: 82,
  LSHIFT: 225, LCTRL: 224,
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

/** All demo keyboards offered in the connect dialog. */
export const MOCK_FIXTURES: MockKeyboardFixture[] = [DEMO_ORTHO_50];
