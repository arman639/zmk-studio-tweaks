# Key-picker rethink: derive the behavior from filled slots

> Internal design note for [issue #16](https://github.com/numachang/zmk-studio-tweaks/issues/16).
> This expands the issue with codebase-grounded detail (file paths, component
> names, the data model, edge cases) and a per-step implementation plan. The
> issue is the user-facing summary; this note is the working design. English is
> authoritative; a Japanese mirror follows below.
>
> Status: **Step 1 shipped (PR #27); Steps 2, 3a, 3b merged to the integration
> branch** (Step 3b via PR #32). See §5. The slot model converged on the
> **Normal / Hold mode** framing (§2) — earlier drafts said "Tap / Hold", renamed
> because "Tap" wrongly implies short-press-only for a plain `&kp`. Coverage of
> every standard ZMK behavior is verified in §4a. **Step 3b deviated from the
> original "parameterised tile" idea (§3c): `&sk`/`&kt` shipped as a *key-state
> latch* — a checkbox pair on the slot label that wraps the Normal key — which
> fits the "wraps a key, not is a key" nature better than a tile.** Step 4 is
> next.

---

## 1. The problem, in terms of the current code

The binding editor today asks the user to **pick a behavior first**, then fill in
its parameters. The flow lives in three components:

- [`src/behaviors/BehaviorBindingPicker.tsx`](../../src/behaviors/BehaviorBindingPicker.tsx)
  — the top of the picker. Renders two rows of tabs and a chip row:
  - tier tabs: **ZMK Standard** / **Firmware Extension** (`tiers`, lines 149-152)
  - category tabs: **Basic / Layer / Hold-Tap / Mouse / System / Other**
    (`GROUP_ORDER`, line 62; `classifyBehavior`, lines 69-82)
  - a `radiogroup` of behavior chips for the active category (lines 313-321)
- [`src/behaviors/BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
  — once a behavior is chosen, renders its parameters. For hold-tap-shaped
  behaviors it already presents **Hold / Tap** tabs (`isHoldTapLike`, line 60).
- [`src/behaviors/ParameterValuePicker.tsx`](../../src/behaviors/ParameterValuePicker.tsx)
  and [`src/behaviors/HidUsagePicker.tsx`](../../src/behaviors/HidUsagePicker.tsx)
  — the actual value inputs (enum dropdown, layer radios, range, and the HID
  keycode grid).

A binding is written to the keyboard by `doUpdateBinding` in
[`src/keyboard/Keyboard.tsx`](../../src/keyboard/Keyboard.tsx) (the
`keymap.setLayerBinding` RPC, lines 253-255), which validates against firmware,
updates the local keymap, and supports undo.

The behaviors and their parameter shapes come from the connected keyboard at
runtime via the `useBehaviors()` hook (`listAllBehaviors` + `getBehaviorDetails`,
[`src/keyboard/Keyboard.tsx`](../../src/keyboard/Keyboard.tsx) lines 38-101). That
hook returns a `BehaviorMap = Record<number, GetBehaviorDetailsResponse>` (line
36), converted to an array with `Object.values(behaviors)` at the call site (line
588) before being handed to `BehaviorBindingPicker` as its `behaviors` prop. Each
entry is a `GetBehaviorDetailsResponse` = `{ id, displayName, metadata? }`, where
`metadata` is an array of `BehaviorBindingParametersSet` = `{ param1[], param2[] }`,
and each parameter value description is one of `constant` / `range` / `hidUsage` /
`layerId` / `nil`.

### Two concrete pains this causes

1. **Key Press ↔ None / Transparent costs a tab round trip.** To set `&none` or
   `&trans` the user must leave the keycode grid, switch the category tab, click
   the chip, and (because those behaviors take no parameters) watch the parameter
   panel turn into a **dimmed, non-interactive HID grid placeholder**
   ([`BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
   lines 100-112). Toggling a key between Key Press and None is one of the most
   common edits, and it pays this cost every time.
2. **Key Press is presented as a choice when it is really the default state.**
   It is the first chip in the Basic group, but conceptually "just type a letter"
   should not require picking a behavior name at all.

---

## 2. Core insight: the behavior is an output, not the first input

What a person holds in their head is *"what does this key do, and does holding it
do something else"* — not the name `&mt`. For the typing + layer + hold-tap core
(≈90% of real keymaps) the behavior follows mechanically from two slots:

- **Normal** — what the key does on a normal press. A keystroke (including a lone
  modifier such as `LSHIFT`), a layer switch, or nothing (None / Transparent).
  *Always present* — every key has a Normal action (even if that action is None).
- **Hold mode** — an **optional** *different* action when the key is held long: a
  modifier (→ Mod-Tap) or a layer (→ Layer-Tap / Momentary Layer). Off by default.

| Normal              | Hold mode | Derived behavior      | Firmware              |
| ------------------- | --------- | --------------------- | --------------------- |
| key                 | (off)     | Key Press             | `&kp <key>`           |
| modifier (as a key) | (off)     | Key Press             | `&kp <mod>`           |
| key                 | modifier  | Mod-Tap               | `&mt <mod> <key>`     |
| key                 | layer     | Layer-Tap             | `&lt <layer> <key>`   |
| None                | layer     | Momentary Layer       | `&mo <layer>`         |
| layer (sub-mode)    | (off)     | To / Toggle / Sticky  | `&to` / `&tog` / `&sl`|
| Transparent         | (off)     | Transparent           | `&trans`              |
| None                | (off)     | None                  | `&none`               |

The change is an inversion of order:

> "pick a behavior, then fill its params" → **"set Normal (and optionally Hold mode), and the behavior is derived."**

### 2a. Why "Normal / Hold mode", not "Tap / Hold"

"Tap" means *short press*, but a plain `&kp A` is **not** short-press-specific: A
is active for the whole press (held → it auto-repeats). Labelling that slot "Tap"
hides that holding also does something. So the base slot is **Normal** — the key's
action on press, regardless of duration. The tap-vs-hold *split* exists only for
hold-tap behaviors, and surfaces in the **derived name** (Mod-Tap, Layer-Tap), not
in the slot labels.

Only **Hold mode** carries an on/off toggle. There is no valid "Normal-off +
Hold-on" behavior — `&mt`/`&lt` always need a Normal keystroke to act as the tap —
so a Normal on/off would be meaningless. Normal is always set (None is a *value*,
not an "off" state).

### 2b. The modifier / layer asymmetry (real, and principled)

A lone **modifier** and a lone **layer** are both "hold to use, tap does nothing",
yet they land in *different* slots:

- A modifier is a **HID keycode**, so a lone modifier is just a key → **Normal**
  (`&kp LSHIFT`). There is no separate "momentary modifier" behavior — `&kp <mod>`
  *is* the held modifier (active immediately on press, no tapping-term) — so a
  modifier alone never goes in Hold mode. Hold mode's Modifier is purely the hold
  half of a Mod-Tap (it needs a Normal key).
- A layer is **not a keycode**. Its "while held" form is a distinct behavior
  (`&mo`), so a lone momentary layer lives in **Hold mode** (Normal = None).

So the slot a *layer* sits in changes what it does:

| Layer placement | Time character                      | Behavior                                  |
| --------------- | ----------------------------------- | ----------------------------------------- |
| Hold mode       | momentary (only while held)         | `&mo` (alone) / `&lt` (with a Normal key) |
| Normal          | persistent (tap to switch, latches) | `&to` / `&tog` / `&sl` (a sub-mode pick)  |

Modifiers have no such momentary-vs-persistent split (only `&kp <mod>`), so a lone
modifier has exactly one home (Normal). This asymmetry is a direct consequence of
"modifiers are keycodes, layers are not" — not an inconsistency.

> Aside (Windows Sticky Keys): a `&kp LSHIFT` emits a real Shift press on every
> tap, exactly like a physical Shift, so 5 quick taps trigger Windows Sticky Keys.
> A home-row mod (`&mt LSHIFT A`) emits the *tap* key (A) on tap and Shift only on
> hold, so rapid taps send A, not Shift. There is no standard ZMK behavior that
> sends Shift only on long-hold; that would need a custom hold-tap, which we do not
> surface.

---

## 3. The interaction shapes

Behaviors split into shapes by how many slots they actually have. The headline is
"two shapes," but precisely there are **three**, because a handful of behaviors are
single-action *with one parameter* — they don't fit "one tile = one binding" nor
the two-slot surface. The behavior selector does not disappear; it is **rebuilt
into (a) tile tabs + (b) a slot surface + (c) parameterised tiles**.

### (a) Tile-select — one tile = one finished binding (zero params)

A single action picked the same way a keycode is picked: open a category tab,
press a tile, done. This is the long-established keycode-editor convention
(category tabs, each a grid of tiles). The firmware `behaviorId` differs per
category, but the UI is uniformly "open a tab, press a tile."

- **Key Press** (HID keycodes) — already the `HidUsagePicker` grid. **Media keys
  belong here, not in a behavior tab:** consumer-page media is just `&kp` on HID
  usage page 12 (it already appears in the placeholder `usagePages` at
  [`BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
  lines 104-109), not a separate behavior. It should live on the Key Press tile
  surface (a page-12 section/tab), not as a behavior category.
- **Mouse** (`&mmv` / `&msc` / mouse key press) — a real, separate behavior, so a
  Mouse tab of tiles is correct.
- **Bluetooth / Output / External Power / System** (Reset, Bootloader, Studio
  Unlock) — each its own tab of tiles. Note these are *one* group today
  (`"System"`, [`BehaviorBindingPicker.tsx`](../../src/behaviors/BehaviorBindingPicker.tsx)
  lines 47-52); splitting them into separate tabs is an expansion from the current
  grouping, not a relabel.
- **None / Transparent** — "clear / make-transparent" tiles, kept available on
  *every* tab (this is Step 1).
- **Caps Word (`&caps_word`) / Key Repeat (`&key_repeat`) / Grave-Escape
  (`&gresc`)** — parameterless single tiles.

### (c) Key-state latches — wrap the Normal key (`&sk` / `&kt`)

`&sk` (sticky key) and `&kt` (key toggle) take a single key/mod parameter, so they
are **not** "one tile = one binding": pressing the tile then needs a key chosen.
The original plan modelled them as a tile that reveals a single-key picker; **as
built (Step 3b) they are instead a *key-state latch*** — the cleaner framing is
that they *wrap* a key rather than *being* a key (like the "+ Send with" implicit
modifiers wrap the Normal key). So they ship as a **checkbox pair on the slot
label** (`Latch: ☐ Sticky Key ☐ Key Toggle`); ticking one turns the current
Normal key into `&sk <key>` / `&kt <key>`, and the key itself is still picked from
the Normal grid. They are mutually exclusive and disabled while Hold mode is on (a
hold-tap can't also be latched); conversely, while a latch is active the grid is
**key-only** (the whole-binding tabs/tiles grey out, but None / Transparent stay
live). Calling them tile-select would be a category error. (See the appendix for
what these flavor behaviors actually do.)

### (b) Slot-fill — two slots, behavior derived per §2

- **Key Press / Mod-Tap / Layer-Tap / Momentary Layer** — derived from the table.
- **What each slot's widget shows (this is where the slot UX is actually decided).**
  The **tap** slot holds a HID key (the `HidUsagePicker` grid) or is empty. The
  **hold** slot is *polymorphic*: it can hold a **modifier** (→ `&mt`), a **layer**
  (→ `&lt` / `&mo`), or — for the "held modifier, empty tap" case — a **plain key**
  (`&kp <mod>`). So the hold slot needs a **composite picker that can choose either
  a layer or a modifier**, which does not exist today (current pickers are
  single-purpose: `ParameterValuePicker` renders *either* layer radios *or* a HID
  grid per the metadata kind). Designing this composite hold-picker is the crux of
  the slot model's feel and is the largest new UI in Step 2.
- **Layer flavors** — when a layer goes in the *tap* slot, `&to` (to-layer) /
  `&tog` (toggle) / `&sl` (sticky layer) are not uniquely implied, so a small
  sub-mode choice is added. These take a **single** layer param, so putting a layer
  on tap **disables the hold slot** (there is nothing to hold) — a constraint the
  surface must enforce visually, not just reject on write.
- **Custom hold-tap behaviors** — firmware-extension behaviors with the hold-tap
  shape (e.g. `homerow_mods`) are detected today by `classifyBehavior` (param2 has
  a `hidUsage`, lines 77-79). When more than one hold-tap behavior exists, a
  "key + mod" slot fill is ambiguous between `&mt` and the custom one, so the
  hold-tap behavior identity is also a sub-mode choice (default `&mt`).
- **Invalid combinations need a defined screen state.** `deriveBinding(slots)`
  (§4) returns `null` for combinations with no behavior — e.g. **key on tap +
  key on hold** (neither modifier nor layer), or a layer in tap while the hold slot
  is somehow populated. The surface must constrain the inputs so most invalid
  states are unreachable, and the reverse-lookup label must have a defined "no
  matching behavior" state for the rest rather than silently writing nothing.
- **Reverse-lookup label (required):** show, unobtrusively, which behavior the
  current slot combination resolves to (e.g. *"this combination = Mod-Tap"*, or
  *"no matching behavior"*), so users who think in ZMK terms never lose track of
  the current state.

---

## 4. Data-model work this requires

The derivation needs a reliable map from intent → `behaviorId`. Today behaviors
are identified **by `displayName` string match** (`STANDARD_BEHAVIOR_GROUPS`,
[`BehaviorBindingPicker.tsx`](../../src/behaviors/BehaviorBindingPicker.tsx) lines
55-57). The slot model leans on this harder, so it should be centralized:

- A small registry mapping the canonical ZMK behaviors we derive to
  (`Key Press`, `Mod-Tap`, `Layer-Tap`, `Momentary Layer`, `To Layer`,
  `Toggle Layer`, `Sticky Layer`, `None`, `Transparent`) to a stable key, resolved
  against the `behaviors` array the picker receives (the `Object.values` of the
  `BehaviorMap`, §1) by `displayName`. **Risk:** `displayName` is firmware-supplied
  and could differ; every lookup must tolerate "not present" and the UI must hide
  derivations/tiles for behaviors the firmware does not expose
  (capability-awareness — already the pattern, since chips only render for
  behaviors in the array).
- A pure helper `deriveBinding(slots) → BehaviorBinding | null` and its inverse
  `bindingToSlots(binding, behaviors) → slots`, so opening an existing key
  pre-fills the slots correctly and editing slots produces a binding. These are
  unit-testable in isolation (the repo already runs Vitest), which is the safest
  place to pin the table in §2.
- **The Hold-mode modifier picker must decode ZMK's implicit-modifier encoding.**
  ZMK packs modifiers into the high byte of a usage value (`LC(...)`, `LS(LALT)`,
  `LC(LSHFT)`, …), so a Mod-Tap hold routinely carries **multiple** modifiers. The
  multi-select modifier picker converts between a held usage and the active
  modifier set with `modifierSetFromUsage` / `usageFromModifierSet`
  ([`slots.ts`](../../src/behaviors/slots.ts)), which strip/restore the high-byte
  bits so a multi-modifier hold survives binding → slots → binding intact.
  (Note: a *lone* modifier is **not** routed to Hold — per §2b it is a Normal
  keystroke (`&kp <mod>`), so `bindingToSlots` decomposes `&kp` straight to the
  Normal slot, no modifier-vs-key heuristic.)

No firmware/RPC changes: the output is still a `BehaviorBinding`
`{ behaviorId, param1, param2 }` handed to the existing `doUpdateBinding`.

### 4a. Coverage — every standard ZMK behavior stays settable

The slot model is **additive**: behaviors it does not own remain reachable through
the existing metadata-driven parameter UI (chips today, tiles after Step 3), so no
default key setting becomes un-settable. Verified against the 25 standard behaviors
the repo knows (`behaviorAliases`, [`keymap-parser.ts`](../../src/keymap-parser.ts)):

- **Slot model (Normal / Hold mode):** `&kp` (incl. a lone modifier, and implicit
  mods via the "+ Send with" column), `&mt`, `&lt`, `&mo`, `&trans`, `&none`
  (Step 2); `&to` / `&tog` / `&sl` as Normal-layer sub-modes (Step 4).
- **Tiles / chips (single-action or 1-param), via `ParameterValuePicker`:** `&sk`,
  `&kt`, `&caps_word`, `&key_repeat`, `&gresc`, `&mkp` / `&mmv` / `&msc`, `&bt`,
  `&out`, `&ext_power`, `&bl`, `&rgb_ug`, `&bootloader`, `&reset`, `&soft_off`,
  `&studio_unlock` (Step 3). All their param kinds (`constant` / `range` /
  `hidUsage` / `layerId` / `nil`) are already handled.
- **Intentionally not offered:** `&mt <non-modifier> <key>` (a held plain key just
  auto-repeats — a footgun) and custom/extension hold-taps (not a ZMK default;
  reachable via chips, §3b). 

During the transition (Steps 2–4) the not-yet-migrated behaviors live in the
residual chip area, so coverage is 100% at every step.

---

## 5. Staged plan (1 PR / 1 feature)

Doing the whole thing at once is too large for this fork's minimal-diff stance.
Steps are ordered so none is a dead end toward the "slots derive the behavior"
end state. Each step is its own PR.

### Step 1 — persistent None / Transparent tiles (smallest, low risk)

- **Goal:** add always-present **None** and **Transparent** tiles to the picker
  so clearing a key never requires a tab round trip. Clicking swaps the binding's
  behavior; the active one is highlighted; the grid stays interactive (press any
  real key to go back to `&kp`). Leave the existing behavior tabs in place.
- **Where:** *inside the key grid, on every tab* (per the issue's "every
  key-grid tab"), rendered as **keycaps** so picking one reads like picking a key:
  a **blank cap = None**, a **▽ cap = Transparent** (None is deliberately left
  blank — a glyph reads as a specific key, and the tooltip/aria-label already
  says "None").
  [`HidUsagePicker`](../../src/behaviors/HidUsagePicker.tsx) takes an optional
  `clearTiles` config and appends the keycaps among the keys of each tab's layout
  (styled identically to a key on that tab — same border, fill and size; the cap
  is omitted from the Other tab, which is a combobox not a grid), on Basic /
  ISO·JIS / Numpad / … and during search (including the no-match state). The
  config is threaded
  [`BehaviorBindingPicker`](../../src/behaviors/BehaviorBindingPicker.tsx) →
  [`BehaviorParametersPicker`](../../src/behaviors/BehaviorParametersPicker.tsx) →
  [`ParameterValuePicker`](../../src/behaviors/ParameterValuePicker.tsx) so the
  tiles appear on every keycode grid the binding renders. Resolve the
  `None`/`Transparent` behaviorIds from the `behaviors` array by `displayName`;
  render a tile only if present. Their now-redundant chips are dropped from the
  behavior groups (the keycaps replace them).
- **A11y:** the tiles are **`aria-pressed` toggle buttons**, not radios. They
  switch the *whole* binding's behavior and reflect which clear behavior (if any)
  is active — so they're not a key (HID-usage) selection, and the same name no
  longer lives in two radiogroups. (This resolves the deferred a11y note from the
  first cut, which used a `role="radio"` strip.)
- **Risk:** low — additive; reuses the existing `setBehaviorId` path and the
  existing `doUpdateBinding` write. When a clear behavior is active the grid stays
  live so clicking a key promotes back to `&kp` in one click; other 0-param
  behaviors keep the dimmed placeholder.
- **Accepted Step 1 trade-off:** dropping the chips means there's no one-click
  clear from a state that renders *no* keycode grid — a layer behavior (layer
  radios, no grid) or a non-`&kp` 0-param like Caps Word (dimmed placeholder).
  Clearing from there takes two clicks (Key Press → ∅). The common Key Press ↔
  None path improves; this rarer gap is left for Step 2, where the slot model
  unifies how every state is cleared. (A cheap partial fix — passing `clearTiles`
  to the dimmed placeholder — would restore one-click clear from Caps Word but not
  from layer behaviors, so it's deferred rather than half-done.)
- **Done when:** from any keycode tab, one click sets `&none`/`&trans`, one click
  on a key returns to `&kp`, and the dimmed-placeholder round trip is gone for
  this case.

### Step 2 — derive `&kp` / `&mt` / `&lt` / `&mo` from the slots (the core)

- **Goal:** the **Normal / Hold mode** surface (§2) replaces naming-then-params for
  the core behaviors, in a new [`SlotBindingPicker.tsx`](../../src/behaviors/SlotBindingPicker.tsx)
  rendered above the residual chips in `BehaviorBindingPicker`. **Normal** is an
  always-shown key grid (with `clearTiles` for None / Transparent and the
  collapsible "+ Send with" implicit-mod column); **Hold mode** is an *on/off*
  checkbox that reveals a `Modifier | Layer` picker (multi-select modifiers; layer
  radios). The derived behavior name is shown, not chosen.
- **Pure model** ([`slots.ts`](../../src/behaviors/slots.ts), unit-tested in
  [`slots.test.ts`](../../src/behaviors/slots.test.ts)): a capability-aware
  `DerivationRegistry` (resolved by `displayName`), `deriveBinding(slots) →
  BehaviorBinding | null`, `bindingToSlots(binding) → slots | null`, and the
  `modifierSetFromUsage` / `usageFromModifierSet` helpers (§4). `validateBinding`
  moved to [`parameters.ts`](../../src/behaviors/parameters.ts) so the tests assert
  every derived binding also passes the firmware-facing check.
- **Round-trip fidelity:** the binding is **binding-lossless** (each core behavior
  stores hold/tap explicitly; `&kp`'s param always decomposes to Normal, so there
  is no modifier-vs-key heuristic). Vitest asserts the round trip *and*
  `validateBinding`.
- **Dual-edit containment:** the slot surface and the residual chips both edit the
  same local `behaviorId/param1/param2` state — one source of truth, no extra slot
  state — and the derivation-target chips (`&kp`/`&mt`/`&lt`/`&mo`, plus
  None/Transparent) are hidden so a behavior is never editable two ways at once.
- **Done when:** setting Normal and toggling Hold mode produces the correct one of
  `&kp` / `&mt` / `&lt` / `&mo` / `&none`, opening such a key shows the right slot
  state (a `&mo` reads as Hold-only at a glance), and the derived binding validates.

### Step 3 — tile-ify the single-action behaviors

Split into two PRs to keep each diff small (this fork's minimal-diff stance).
Media already folds into the Key Press / Normal grid (page 12), done in Step 2.

> **Plan note (build the end-state incrementally).** Rather than parking migrated
> behaviors in throwaway scaffolding until Step 5 unifies everything, each step
> moves its behaviors into (or toward) their **final** place, so the converged
> surface is visible — and therefore critiquable — at every step. Step 3a already
> realizes the key part of the Step 5 end-state (behavior tiles living in the
> Normal grid's tab strip), so Step 5 shrinks to retiring whatever residual chip
> area remains.

**Step 3a — keycap behavior tiles in the Normal grid's tab strip.**

- **Tile-able behaviors → keycap tiles.** A behavior is *tile-able* when **all**
  its parameters are `constant` / `range` / `nil` / absent, so each concrete
  `(param1, param2)` combination is a finished binding (shape (a), §3a). An
  enum/range parameter is **exploded** into one tile per value (e.g. Bluetooth →
  `BT_SEL 0…N`, `BT_CLR`, …). Tiles are styled as **keycaps** so picking a
  behavior reads the same as picking a key. A behavior whose parameter needs a
  rich picker — a HID key or a layer (`&sk` / `&kt`, the persistent-layer
  behaviors, custom hold-taps) — is **not** tile-able and keeps the chip +
  parameter-picker flow.
- **Single-action behaviors join the Normal grid's tab strip.** Instead of a
  separate behavior-tab area, the tile-able single-action behaviors render as
  extra tabs **in the same tab strip as the keycode grid**, inserted between
  *International* and *Other*: a **Mouse** tab, and a consolidated **System** tab
  that folds Bluetooth / Output / External Power / System (Reset / Bootloader /
  Studio Unlock) into one tab of labelled keycap-tile sections. Picking a keycode
  tile fills the Normal key (→ `&kp`); picking a behavior tile sets the **whole**
  binding (→ `&mkp` / `&bt` / `&reset` / …). The reverse-lookup slot label names
  the active behavior (e.g. *"Slots = Reset"*), and its tile/tab is highlighted —
  which dissolves most of the §8a "non-core binding shows an empty slot surface"
  blocker (the binding is now named and visible, not silently overwritten).
- **Residual "More behaviors" area shrinks** to the not-yet-migrated, non-strip
  behaviors: the parameterless Basic singles (`&caps_word` / `&key_repeat` /
  `&gresc`, as keycap tiles), the still-chip `&sk` / `&kt` (→ Step 3b), and the
  persistent-layer / custom hold-tap chips (→ Step 4). Its tier tabs are gone
  (single flat category row).
- **Pure helper** ([`tiles.ts`](../../src/behaviors/tiles.ts), unit-tested):
  `tileBindingsFor(behavior) → BehaviorTile[] | null` and the `BindingTileTab`
  shape the Normal grid consumes. [`HidUsagePicker`](../../src/behaviors/HidUsagePicker.tsx)
  gains optional `extraTabs` / `activeBinding` / `onSelectBinding` so the
  behavior tabs live in its tab strip without disturbing its other uses.
- **Tab-strip fit (two follow-on tweaks driven by the wider strip).** Adding
  Mouse / System made the keycode tab strip overflow next to the always-on
  implicit-modifier column, so:
  - **One host-adaptive "Basic" tab** replaces the old fixed *Basic* (ANSI) +
    *ISO/JIS* pair. The single tab renders the shape matching the selected host
    layout (`layout.physical`): ANSI for `ansi`, ISO for `iso` (adds NUHS /
    NUBS), JIS for `jis` (¥ / IME), KO for `ko`. The old design always showed an
    ANSI tab plus an adaptive one (which, on ANSI, rendered ISO and thus surfaced
    NUHS/NUBS a US board lacks). Now ISO-only keys appear only once an ISO/JIS
    layout is selected — matching the physical board — and stay reachable via the
    search box regardless. One fewer tab, and correct ANSI for US users.
  - **The "+ Send with" (implicit-modifier) picker moves out of the side column.**
    On the Normal-slot surface (`inline` mode), it's a compact "Send with" row of
    modifier toggles **below the full-width grid**, shown only on the tabs where
    composing a modified keycode applies (Basic / Function + Nav) and hidden
    elsewhere — so it never steals tab/grid width. Other `HidUsagePicker` uses
    (the Sticky Key / Key Toggle key picker) keep the side column.
  - **Normal-surface chrome trimmed.** With the modifiers inline, the grid's
    redundant "Key" header is dropped and the **search box moves up onto the
    "NORMAL" row** (the slot already labels the section), so "Key" / "Send with"
    are no longer competing section headers. `HidUsagePicker` gains `inline` +
    controlled `search` / `onSearchChange`; the slot surface owns the search box.
    The filter now also **spans the behavior tiles** (matching tile label /
    section / tab), so a search like `reset` / `bt` / `mouse` surfaces the
    Mouse / System tiles too — the search box stops being keycode-only now that
    those tiles share the surface.
  - **Host-layout-aware reverse label.** The "NORMAL = <key>" label resolves the
    glyph through the active host layout (like the grid), so on JIS, Shift+2 reads
    `"` not the ANSI `@`.
  - **Devicetree code on the slot label.** Next to "Slots = <behavior>" the
    surface shows the binding as the ZMK code an author would write — `&mt LSHFT
    RET`, `&kp Q`, `&mo 1`, `&bt BT_SEL 0`, `&reset`. `formatBinding`
    ([`parameters.ts`](../../src/behaviors/parameters.ts), unit-tested) reuses the
    existing `dtsRefForDisplayName` / `formatBindingParam` serializers and prefers
    a parameter's metadata constant name (the ZMK macro) over its raw number.
  - **Keycode-picker cleanups (driven by a DRY review).** Tab identifiers are
    named constants (no duplicated `"Function + Nav"` / `"Other"` magic strings
    across the categorizer, tab-order list, panel renderer, and modifier-row
    check). The common consumer media keys (Play / Pause / Stop / Next / Prev /
    Vol± / Mute, a curated HID-id set) are promoted out of the "Other" catch-all
    onto the **Apps/Media/Special** tab. The remaining "Other" combobox — a long
    consumer-page tail the HID spec leaves uncategorised — is grouped into
    **labelled sections** (Keyboard/Keypad · Media & Playback · Audio · Display &
    Camera · Application Launch · Application Control · Telephony & Contacts ·
    Other) derived from the usage, so it's navigable. The filter and the section
    grouping both read from the derived usage data, not hand-maintained lists.
- **Tile styling:** behavior tiles are keycaps with the same height/font as the
  keycode tiles (widening for longer labels, not shrinking the text); section
  headings (`BLUETOOTH`, …) are `text-sm` so they read as real dividers.

**Step 3b — `&sk` / `&kt` key-state latches + Basic flavor tiles (shipped, PR #32).**

The Basic "flavor" behaviors leave the residual chip area entirely, so the
"More behaviors" Basic group is gone. They split by shape:

- **`&sk` / `&kt` → key-state latch (§3c).** A `Latch: ☐ Sticky Key ☐ Key Toggle`
  checkbox pair on the slot label that wraps the Normal key (`&kp K` → `&sk K` /
  `&kt K`); the key is picked from the grid. Mutually exclusive with each other
  and with Hold mode; while latched the grid is key-only (Mouse / System tabs and
  the one-tap tiles disable, None / Transparent stay live). Lives in
  [`SlotBindingPicker.tsx`](../../src/behaviors/SlotBindingPicker.tsx)
  (`keyStateWrappers`, `toggleWrapper`, wrapper-aware `setNormalKey`); the grid's
  `keyOnly` mode is in [`HidUsagePicker.tsx`](../../src/behaviors/HidUsagePicker.tsx).
- **Caps Word / Key Repeat / Grave-Escape → one-tap tiles.** 1U keycap tiles in a
  2-column block on the Basic tab, with None / Transparent pinned to the bottom
  row; labels wrap at the largest font that fits a 1U cap.
- **Supporting:** `isParamTileable` ([`tiles.ts`](../../src/behaviors/tiles.ts))
  detects the single-key-param shape (callers gate `!isCoreBinding`, since Key
  Press shares it). [`keymap-parser.ts`](../../src/keymap-parser.ts) gained the
  missing `kt` alias and a `gresc` → `Grave/Escape` fix so the slot code label
  renders `&kt` / `&gresc`. The demo fixtures expose all three new behaviors.

- **Risk:** medium — mostly UI; reuses the grid/tile patterns from
  [`HidUsagePicker.tsx`](../../src/behaviors/HidUsagePicker.tsx). Capability-aware:
  a tab/tile/latch renders only for behaviors the firmware exposes.

### Step 4 — layer in the Normal slot (To / Toggle / Sticky) + custom hold-tap

- **Goal:** let the **Normal** slot hold a *layer* (not just a key), which derives
  the persistent layer switches — `&to` / `&tog` / `&sl` — with a small sub-mode
  pick (they take one layer param and differ only in latch behavior, §2b). Add the
  custom-hold-tap identity choice for when more than one hold-tap behavior exists
  (§3b, default `&mt`). The reverse-lookup label already ships with Step 2.
- **Note:** this is the *persistent* layer case; the *momentary* layer (`&mo`) and
  Layer-Tap (`&lt`) live in **Hold mode** and already land in Step 2. A layer in
  Normal disables Hold mode (a tap-to-switch has no hold half).
- **Risk:** low-medium — additive sub-mode selector on the Normal slot.

### Step 5+ — remove the top-level behavior tabs (later, needs its own design)

- **Goal:** retire the tier/category tab hierarchy entirely in favor of
  "(a) tile tabs + (b) slot surface + (c) parameterised tiles." Deferred; needs its
  own design pass once Steps 1-4 have proven the model in use.

---

## 6. Capability-awareness & non-goals

- **Capability-aware throughout:** tiles and derivations appear only for
  behaviors the connected keyboard's firmware actually exposes. This is already
  how the picker works (chips render from the `behaviors` array); the slot
  model must preserve it — never derive to a behavior that isn't present.
- **No firmware or RPC changes.** Output remains a `BehaviorBinding`.
- **No new behaviors.** This is purely a presentation/interaction change over the
  behaviors the firmware already ships.
- **Minimal diff per step.** One PR per step; no opportunistic refactors.

---

## 7. Upstream

The "category tabs of tiles" arrangement is a widely established convention across
keycode editors generally, not specific to any one tool. This is a general UX
improvement that could be worth proposing upstream
([`zmkfirmware/zmk-studio`](https://github.com/zmkfirmware/zmk-studio)) once it
takes shape; the direction is adjacent to upstream
[PR #159](https://github.com/zmkfirmware/zmk-studio/pull/159) (Grid Picker for HID
Usage), which is worth watching. Per this fork's stance, anything fork-specific
stays here and is not pushed upstream.

---

## 8. Open questions

1. **`displayName` matching fragility.** The whole derivation keys off
   firmware-supplied display names. Note the numeric `behaviorId` is **not** a
   stable alternative — it is assigned by the firmware at runtime and varies per
   build/keyboard, so it cannot be hardcoded. Is there some other stable identifier
   (a well-known behavior name constant, a metadata signature) we can match on, or
   do we accept the `displayName` string match and degrade gracefully when names
   differ? (Current direction: keep the string match + graceful "not present.")
2. **Multiple hold-tap behaviors.** When `homerow_mods` and `&mt` both exist, what
   is the default for a Normal-key + Hold-modifier fill, and how prominent should
   the sub-mode switch be? (Deferred to Step 4.)
3. ~~**The "hold a modifier, empty tap" case.**~~ **Resolved (§2b):** a lone
   modifier is a HID keycode, so it is a **Normal** keystroke (`&kp <mod>`), not a
   Hold. Hold mode's Modifier is only the hold half of a Mod-Tap. There is no
   "momentary modifier" behavior to surprise anyone with.
4. **Step 5 scope.** How much of the old tab hierarchy, if any, should survive as
   an "advanced" escape hatch for behaviors that don't fit either shape?

### 8a. Before-main blockers (from the PR #29 review)

These are acceptable on the integration branch but **must be resolved before the
integration branch merges to `main`**:

- **Non-core bindings on the slot surface — largely resolved by Step 3a.** A
  non-core current binding no longer reads as a blank *"No matching behavior"*:
  the slot label now **names the actual behavior** (e.g. *"Slots = Reset"*) and
  shows its **devicetree code** (`&reset`, `&bt BT_SEL 0`, …), and the behavior's
  tile is highlighted in its tab (Mouse / System) — so the state is visible, not
  silent. The Normal grid is shared with the behavior tabs by design, so picking a
  key on the Basic tab is the *deliberate* way to switch a non-core binding back
  to a Normal `&kp` (no longer a silent footgun on a stray click). The not-yet-
  tiled chip behaviors (Sticky Key / Key Toggle → Step 3b; persistent layers →
  Step 4) keep the same labelled-and-coded state. **Confirm the feel before
  `main`**, but the silent/ambiguous part of the blocker is gone.
- **Minor (acceptable for now):** `deriveBinding → null` makes `writeSlots` a
  no-op (silent) when the firmware doesn't expose the derived behavior; tie this
  to the reverse-lookup "no matching behavior" state rather than doing nothing.

---

## Appendix — what the "flavor" behaviors actually do

Reference for the small Basic-group behaviors Step 3 would tile. Easy to forget
since they're rarely used day-to-day.

- **`&sk` Sticky Key (one-shot modifier):** tap and release, and the *next single
  key* gets that modifier. Tap Sticky Shift → next `a` types `A`. Avoids holding
  the modifier. Takes a key (usually a modifier) as its param.
- **`&kt` Key Toggle:** each tap toggles the key's pressed/released state.
  `&kt LSHIFT` → Shift latches on, tap again to release. A Caps-Lock for any key.
  Takes a key param.
- **`&caps_word`:** like Caps Lock but turns off automatically at the end of a
  word. Great for `MAX_BUFFER_SIZE`-style constants without a stuck caps. No param.
- **`&key_repeat`:** re-sends the last key that was sent. Rarely used. No param.
- **`&gresc` Grave/Escape (mod-morph):** sends Esc normally, but sends `` ` ``/`~`
  when combined with Shift or GUI. Lets a 60% board share Esc and `` ` `` on one
  key. No param.

---

# （日本語）スロットを埋めると behavior が決まる方式へ

> [issue #16](https://github.com/numachang/zmk-studio-tweaks/issues/16) の内部設計メモ。
> issue の要約に、コードに即した詳細（ファイルパス・コンポーネント名・データ
> モデル・エッジケース）と段階別の実装計画を足したもの。issue が対外的な要約、
> こちらが作業用の設計。英語が正、本節はそのミラー。
>
> ステータス: **Step 1 出荷済み（PR #27）／ Step 2 実装中。** スロットモデルは
> **Normal / Hold mode** 方式に収束（§2）。初期案の「Tap / Hold」は、ただの `&kp`
> に対して「Tap＝短押し」が誤解を招くため改名した。全標準 ZMK behavior の設定可否は
> §4a で確認済み。

## 1. 現状コードに即した問題

binding エディタは今、まず behavior を選ばせ、その後でパラメータを埋めさせる。
流れは 3 つのコンポーネントに分かれる:

- [`BehaviorBindingPicker.tsx`](../../src/behaviors/BehaviorBindingPicker.tsx) —
  picker の上部。tier タブ（**ZMK Standard / Firmware Extension**）、カテゴリ
  タブ（**Basic / Layer / Hold-Tap / Mouse / System / Other**、`classifyBehavior`
  69-82 行）、アクティブカテゴリの behavior チップ列（313-321 行）。
- [`BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
  — behavior 選択後にパラメータを描画。hold-tap 形状の behavior には既に
  **Hold / Tap** タブを出している（`isHoldTapLike`, 60 行）。
- [`ParameterValuePicker.tsx`](../../src/behaviors/ParameterValuePicker.tsx) と
  [`HidUsagePicker.tsx`](../../src/behaviors/HidUsagePicker.tsx) — 実際の値入力
  （enum セレクト・レイヤーラジオ・range・HID キーコードグリッド）。

binding はキーボードへ `doUpdateBinding`（[`Keyboard.tsx`](../../src/keyboard/Keyboard.tsx)
の `keymap.setLayerBinding` RPC, 253-255 行）で書く。behavior とパラメータ形状は
接続中のキーボードから `useBehaviors()`（`listAllBehaviors` + `getBehaviorDetails`,
38-101 行）で実行時に取得する。同フックが返すのは `BehaviorMap = Record<number,
GetBehaviorDetailsResponse>`（36 行）で、呼び出し側 588 行の `Object.values(behaviors)`
で**配列化**してから `BehaviorBindingPicker` の `behaviors` prop へ渡る。各要素は
`{ id, displayName, metadata? }`。

### これが生む 2 つの具体的不満

1. **Key Press ↔ None / Transparent がタブ往復を要する。** `&none` / `&trans` に
   するにはキーコードグリッドを離れ、カテゴリタブを切り替え、チップを押し、param
   なしゆえに**薄い操作不可の HID グリッド placeholder**
   （[`BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
   100-112 行）を見る羽目になる。Key Press ↔ None は最頻の編集なのに毎回この往復。
2. **Key Press は本来「既定の状態」なのに「選択肢」として並んでいる。** Basic 群
   の先頭チップだが、「ただ文字を打つ」のに behavior 名を選ばせる必要はない。

## 2. 核心: behavior は最初の入力ではなく結果

人の頭にあるのは「このキーは何をする／長押しで別のことをするか」であって `&mt`
という名前ではない。中核（実キーマップの約 9 割）では 2 つのスロットから behavior が
機械的に決まる:

- **Normal** … 普通に押したときの動作。キーストローク（`LSHIFT` 等の単独修飾も含む）、
  レイヤー切替、または無し（None / Transparent）。**常に存在**（None も“値”）。
- **Hold mode** … 長押ししたときの**“別の”動作（任意）**。修飾（→ Mod-Tap）か
  レイヤー（→ Layer-Tap / Momentary Layer）。既定オフ。

| Normal            | Hold mode | 派生 behavior        | ファーム               |
| ----------------- | --------- | -------------------- | ---------------------- |
| キー              | （オフ）  | Key Press            | `&kp <key>`            |
| 修飾（キーとして）| （オフ）  | Key Press            | `&kp <mod>`            |
| キー              | 修飾      | Mod-Tap              | `&mt <mod> <key>`      |
| キー              | レイヤー  | Layer-Tap            | `&lt <layer> <key>`    |
| None              | レイヤー  | Momentary Layer      | `&mo <layer>`          |
| レイヤー(サブモード)| （オフ）| To / Toggle / Sticky | `&to` / `&tog` / `&sl` |
| Transparent       | （オフ）  | Transparent          | `&trans`               |
| None              | （オフ）  | None                 | `&none`                |

順序の反転:「behavior を選んでから param」→「**Normal（と任意で Hold mode）を埋めれば
behavior が派生する**」。

### 2a. なぜ「Tap / Hold」でなく「Normal / Hold mode」か

「Tap」は**短押し**を意味するが、ただの `&kp A` は短押し専用ではない（押している間
ずっと A、長押しはリピート）。そのスロットを「Tap」と呼ぶと長押し分が見えなくなる。
だから基本スロットは **Normal**（押したときの動作・押す長さに依らない）。タップ/
ホールドの**区別**は hold-tap のときだけ生まれ、**派生名**（Mod-Tap, Layer-Tap）に
現れる。on/off があるのは **Hold mode だけ**——「Normal オフ＋Hold オン」に当たる
behavior が無い（`&mt`/`&lt` は必ず Normal のキーをタップ側に要る）ため。

### 2b. 修飾／レイヤーの非対称（実在し、筋が通る）

単独の**修飾**も単独の**レイヤー**も「長押しで使う・タップは無反応」だが、入る
スロットが違う:

- 修飾は **HID キーコード**なので単独ならただのキー → **Normal**（`&kp LSHIFT`）。
  「モメンタリ修飾」という別 behavior は無い（`&kp <mod>` がそれ・押した瞬間に即時
  有効）ので、単独修飾は Hold mode に入らない。Hold mode の修飾は Mod-Tap の長押し側
  専用（Normal にキーが要る）。
- レイヤーは**キーコードではない**。「押している間」の形が別 behavior（`&mo`）なので、
  単独のモメンタリは **Hold mode**（Normal = None）。

ゆえにレイヤーは**置くスロットで意味が変わる**:

| レイヤーの場所 | 時間的性質 | behavior |
| --- | --- | --- |
| Hold mode | モメンタリ（押している間だけ） | `&mo`（単独）/ `&lt`（Normal キー付き） |
| Normal | 持続（タップで切替・残る） | `&to` / `&tog` / `&sl`（サブモード選択） |

修飾にはこの「一時 vs 持続」が無い（`&kp <mod>` のみ）ので、単独修飾の居場所は
Normal 一択。この非対称は「**修飾はキーコード、レイヤーはそうでない**」の直接の帰結で、
矛盾ではない。

> 補足（Windows 固定キー）: `&kp LSHIFT` はタップごとに本物の Shift 押下を送る（物理
> Shift と同じ）ので、5 回連打で固定キーが発動する。ホームロウ Mod（`&mt LSHIFT A`）
> はタップで A を送り Shift は長押し時だけなので、連打しても A が出る。長押し時だけ
> Shift を送る標準 behavior は無く、それには自作 hold-tap が要る（出さない）。

> 注: 以下 §3〜§8 は旧「Tap / Hold」表記が残る箇所がある（= 新「Normal / Hold mode」）。
> カバレッジ確認（§4a）と段階計画の最新は**英語版が正**。要点は上の §2/§2a/§2b に集約。

## 3. 操作形

behavior は「実際にいくつ枠を持つか」で形が分かれる。見出しは「2 つ」だが厳密には
**3 つ**——単一アクションだが**パラメータ 1 つ**を取る一群があり、「1 タイル＝完成」
にも 2 枠スロットにも収まらない。セレクタは「消える」のではなく **(a) タイルタブ群
＋ (b) スロット面＋ (c) パラメータ付きタイル**へ作り替わる。

### (a) タイル選択型 — 1 タイル＝完成 binding（param なし）

キーコードと同じ所作（タブを開いてタイルを押す）。キーコードエディタ全般の確立
された型。

- **Key Press**（HID キーコード）— 既存の `HidUsagePicker` グリッド。**メディアキーは
  behavior タブではなくここ**: consumer メディアは HID usage page 12 上の `&kp`
  にすぎず（placeholder の `usagePages` にも既出、
  [`BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
  104-109 行）、独立 behavior ではない。Key Press タイル面（page 12 のセクション/
  タブ）に内包すべきで、behavior カテゴリにはしない。
- **Mouse**（`&mmv` / `&msc` / mouse key press）— 実在の独立 behavior なので Mouse
  タブのタイル化で正しい。
- **Bluetooth / Output / External Power / System**（Reset, Bootloader, Studio
  Unlock）— それぞれタイルのタブ。ただし現状はこれらで**1 グループ**（`"System"`,
  [`BehaviorBindingPicker.tsx`](../../src/behaviors/BehaviorBindingPicker.tsx) 47-52
  行）。別タブへの分割は現状グルーピングからの**拡張**であり単なる改名ではない。
- **None / Transparent** — 全タブ常設の「空にする／透過」タイル（= Step 1）。
- **Caps Word / Key Repeat / Grave-Escape** — param なし単発タイル。

### (c) キー状態ラッチ — Normal キーを包む（`&sk` / `&kt`）

`&sk`（sticky key）と `&kt`（key toggle）はキー/修飾 param を 1 つ取るので「1 タイル
＝完成」では**ない**: 当初案は「タイルを押すと単一キーピッカー」だったが、**実装
（Step 3b）はキー状態ラッチに変更**。これらは「キーである」より「キーを包む」もの
（"+ Send with" の暗黙修飾が Normal キーを包むのと同類）なので、**スロットラベル上の
チェックボックス対**（`Latch: ☐ Sticky Key ☐ Key Toggle`）として出す。チェックすると
現在の Normal キーが `&sk <key>` / `&kt <key>` になり、キー自体は通常どおりグリッドで
選ぶ。両者は排他、Hold mode 中は無効（hold-tap はラッチ不可）。逆にラッチ中はグリッドが
**キー専用**（whole-binding のタブ/タイルは無効、None / Transparent は生存）。（小物
behavior の挙動は付録参照。）

### (b) スロット型 — 2 枠、behavior は §2 で派生

- **Key Press / Mod-Tap / Layer-Tap / Momentary Layer** — 表から派生。
- **各枠のウィジェットに何が出るか（スロットの使い心地はここで決まる）。** **タップ**
  枠は HID キー（`HidUsagePicker` グリッド）か空。**ホールド**枠は**多態**で、**修飾**
  （→ `&mt`）・**レイヤー**（→ `&lt` / `&mo`）・「修飾ホールド・タップ空」の**通常キー**
  （`&kp <mod>`）のいずれも取りうる。よってホールド枠には**レイヤーか修飾を選べる複合
  ピッカー**が要るが、現状は存在しない（既存 `ParameterValuePicker` は metadata の種別に
  応じてレイヤーラジオ**か** HID グリッドの**片方**しか出さない単機能）。この複合
  ホールドピッカーの設計がスロット方式の感触を左右し、Step 2 最大の新規 UI。
- **レイヤーの味付け** — タップ枠にレイヤーが入ると `&to` / `&tog` / `&sl` が一意に
  決まらないのでサブモード選択を足す。これらは**単一**レイヤー param なので、タップに
  レイヤーを置くと**ホールド枠は無効化**（ホールドするものが無い）——書き込み時に弾く
  のではなく面上で視覚的に制約する必要がある。
- **カスタム hold-tap** — hold-tap 形状の拡張 behavior（例 `homerow_mods`）は今も
  `classifyBehavior`（param2 が `hidUsage`, 77-79 行）で検出。複数あると「キー＋
  修飾」が `&mt` と曖昧なので、hold-tap の identity もサブモード選択（既定 `&mt`）。
- **無効な組み合わせには定義済みの画面状態が要る。** `deriveBinding(slots)`（§4）は
  behavior に該当しない組み合わせ——例: **タップにキー＋ホールドにキー**（修飾でも
  レイヤーでもない）、タップにレイヤーがあるのにホールド枠が埋まっている——で `null`
  を返す。面は入力を制約して大半の無効状態を到達不能にし、残りは逆引きラベルに
  「該当 behavior なし」状態を定義する（黙って何も書かない、にしない）。
- **逆引きラベル（必須）** — いまの枠の組み合わせがどの behavior に化けているか
  （または「該当 behavior なし」）を控えめに表示し、ZMK 用語で考える人が現在状態を
  見失わないようにする。

## 4. 必要なデータモデル作業

派生には「意図 → `behaviorId`」の確実な対応が要る。今 behavior は **`displayName`
文字列一致**で識別している（`STANDARD_BEHAVIOR_GROUPS`, 55-57 行）。スロット方式は
これに強く依存するので集約すべき:

- 派生対象の正規 behavior（Key Press / Mod-Tap / Layer-Tap / Momentary Layer /
  To Layer / Toggle Layer / Sticky Layer / None / Transparent）を安定キーに対応
  づけ、picker が受け取る `behaviors` 配列（`BehaviorMap` の `Object.values`, §1）
  から `displayName` で解決する小さなレジストリ。**リスク:** `displayName` はファーム
  供給で差異がありうる。全ルックアップは「不在」を許容し、ファームが公開しない
  behavior の派生/タイルは出さない（capability 連動——チップが配列からしか描画され
  ない既存挙動を保つ）。
- 純粋関数 `deriveBinding(slots) → BehaviorBinding | null` と逆変換
  `bindingToSlots(binding, behaviors) → slots`。既存キーを開くとスロットが正しく
  埋まり、スロット編集が binding を生む。Vitest で単体テスト可能（既にテスト基盤
  あり）——§2 の表を固定する最も安全な場所。
- **修飾検出は base usage 8 種一致では足りず、ZMK の implicit-modifier 符号化を
  解く必要がある。** ホールド値が「修飾」なのは base HID 修飾 8 種（L/R Ctrl/Shift/
  Alt/GUI）のときだけでなく、**修飾ビットを載せた任意キーコード**のときも——ZMK は
  修飾を usage 値の上位ビットに詰める（`LC(...)`, `LS(LALT)`, `LC(LSHFT)` …）ため、
  ユーザは**複数修飾**を普通にホールドに載せる。8 種一致だけだと `bindingToSlots` が
  それらを取りこぼし round-trip が壊れる。判定（とホールド枠の複合ピッカー §3b）は
  implicit-modifier 符号化を理解し、複数修飾ホールドが binding → slots → binding で
  無傷に通るようにする。

ファーム/RPC 変更なし: 出力は従来どおり `BehaviorBinding` で既存 `doUpdateBinding`
に渡す。

## 5. 段階計画（1 PR / 1 機能）

一気にやると差分が大きく、本フォークの最小主義から外れる。終着点（スロットで派生）
へ後戻りしない順で進める。各 Step は独立 PR。

- **Step 1（最小・低リスク）** — **キーグリッドの各タブ内**に常設の **None /
  Transparent** タイル（issue の「全 key-grid タブ」に忠実）。**キーキャップ**として
  描画し、選ぶ動作が「キーを選ぶ」のと同じに見えるようにする（**ブランクのキャップ＝
  None**、**▽ キャップ＝Transparent**。None はあえて空——グリフを入れると特定キーに
  見えるし、ツールチップ／aria-label で "None" が出る）。
  [`HidUsagePicker`](../../src/behaviors/HidUsagePicker.tsx) に任意の `clearTiles`
  設定を渡し、各タブのレイアウトのキーに混ぜて描画（そのタブのキーと同じ枠・塗り・
  サイズ。Other タブは combobox でキーではないので出さない）——Basic / ISO·JIS /
  Numpad … と検索中（0件時も）表示。設定は
  [`BehaviorBindingPicker`](../../src/behaviors/BehaviorBindingPicker.tsx) →
  [`BehaviorParametersPicker`](../../src/behaviors/BehaviorParametersPicker.tsx) →
  [`ParameterValuePicker`](../../src/behaviors/ParameterValuePicker.tsx) と通し、
  binding が出す全キーコードグリッドに出る。クリックで behavior 差し替え、選択中は
  ハイライト、クリア中もグリッドは操作可能（キー押下で1クリック `&kp` 復帰）。冗長に
  なった None/Transparent のチップは behavior 群から外す（キーキャップで代替）。既存
  タブ自体は残す。**割り切り（Step 1）**: チップを消したため、キーコードグリッドを
  出さない状態（レイヤー系・Caps Word 等）からのクリアは2クリックになる。よくある
  Key Press↔None は改善。この稀なギャップは Step 2 のスロットモデルで統一する。
  **A11y:** タイルは radio ではなく **`aria-pressed` トグルボタン**——
  binding 全体の behavior を切り替え、どのクリア behavior が有効かを表すだけで、キー
  （HID usage）選択ではない。同名が2つの radiogroup に跨る問題も解消（初版の
  `role="radio"` ストリップで先送りした a11y 指摘の解決）。behaviorId は `behaviors`
  配列から解決し在るときだけ描画。既存 `setBehaviorId` と `doUpdateBinding` を再利用。
  **一番の不満が消える最小単位。**
- **Step 2（核）** — `deriveBinding` / `bindingToSlots`（§4）を実装し、4 つの中核
  behavior について Hold / Tap 枠を埋めれば `&kp` / `&mt` / `&lt` / `&mo` が派生
  するようにする。Hold/Tap タブが主役になり、名前は選ぶのではなく表示される。
  リスクは中——2 つの別ハザード:
  - *往復の忠実度。* **binding** は binding → slots → binding で保たれるが、**スロット
    分解はヒューリスティック**: `&kp LSHIFT` がどちらの枠に入るかはキーコード型からの
    推論（単独修飾→ホールド、通常キー→タップ）であって保存値ではない。Step 2 は
    「slot-lossless」ではなく「**binding-lossless**」と表現する。Vitest は往復に加え、
    `deriveBinding` の出力が既存 `validateBinding`（呼び出し 227-234 行）を通ること
    も検証し、派生 binding がファーム経路で弾かれないことを保証する。
  - *二重編集の状態同期（移行期ハザード）。* Step 5 までトップのチップ列が残るため、
    同じ binding がチップ選択でもスロット埋めでも編集できる二重 UI になる。既存の
    `binding` prop と局所 `behaviorId/param1/param2` 状態（210-247 行）に加え、スロット
    状態が第 3 の真実源となり、チップ↔スロットの相互作用（「Mod-Tap」チップ押下 vs
    ホールド枠を埋める）の整合を保つ必要がある。封じ込めとして、スロット面が担う
    派生対象 behavior（`&kp`/`&mt`/`&lt`/`&mo`）の**チップは早めに隠し**、両方を活かして
    三重同期しない。
- **Step 3（タイル化）** — 差分を小さく保つため 2 PR に分割（英語版が正）。メディアは
  Step 2 で Key Press / Normal グリッド（page 12）に内包済み。
  - **方針（最終形を逐次作る）** — 移行した behavior を Step 5 まで使い捨ての仮置き場に
    留めず、各 Step で**最終的な場所**へ動かす。こうすれば収束後の面が毎 Step 見えて、
    改善を指摘できる。3a で既に Step 5 終着形の要（behavior タイルを Normal グリッドの
    タブ列に置く）を実現するので、Step 5 は残りのチップ領域の撤去だけに縮む。
  - **3a（Normal グリッドのタブ列にキーキャップ behavior タイル）** — パラメータが全て
    constant / range / nil / 無しの「タイル可能」behavior を、`(param1,param2)` の全組合せ
    1 タイルずつ・**キーキャップ風**に。enum/range は**各値を個別タイルに展開**（例:
    `BT_SEL 0…N`）。これらを別領域ではなく**キーコードグリッドと同じタブ列**に追加し、
    International↔Other の間に **Mouse** タブと、Bluetooth/Output/External Power/System を
    1 つに集約した **System** タブを差し込む。キーコードタイルは Normal キー（→`&kp`）、
    behavior タイルは**binding 全体**（→`&mkp`/`&bt`/`&reset` 等）を設定。逆引きラベルが
    現在の behavior 名を出し（例「Slots = Reset」）タイル/タブをハイライトするので、§8a の
    「非コア binding で空スロット面」ブロッカーの大半が解消（黙って上書きされず、名前が
    見える）。HID キー/レイヤーの param が要る `&sk` / `&kt`・持続レイヤー・カスタム
    hold-tap は**タイル不可**でチップ継続。tier タブは廃止（カテゴリ一列）。残置「More
    behaviors」は未移行分（caps_word/key_repeat/gresc タイル＋ sk/kt チップ＋レイヤー等）に
    縮小。`HidUsagePicker` に `extraTabs` / `activeBinding` / `onSelectBinding` を追加。
  - **タブ列の収まり（幅対策2点）** — Mouse/System 追加でキーコードタブ列が修飾列と幅を
    奪い合いあふれたため: ①**Basic を host 連動の1タブに統合**（旧「Basic(ANSI固定)＋ISO/JIS」
    を廃し、選択中ホスト配列で ansi→ANSI / iso→ISO(NUHS/NUBS) / jis→JIS / ko→KO を出し分け。
    ANSI ユーザーは ANSI 形状で正しく、ISO/JIS キーは配列選択時のみ出る・検索からは常時可）。
    ②**「+ Send with」をサイド列から外す**: Normal 面（inline）ではグリッド全幅の下に
    「Send with」修飾トグル行として置き、Basic / Function+Nav のみ表示（他タブ非表示）。
    sk/kt のキーピッカー等は従来のサイド列のまま。③Normal 面の chrome 整理: 修飾を行に
    したので冗長な「KEY」ラベルを廃し、**検索ボックスを「NORMAL」行へ移設**（節見出しは
    NORMAL が兼ねる）。`HidUsagePicker` に `inline` ＋ controlled `search`/`onSearchChange`。
    ④タイルはキーキャップ風に文字サイズ統一、セクション見出しを `text-sm` に。
  - **3b（出荷済み・PR #32）** — `&sk` / `&kt` をキー状態ラッチ（§3c）に。スロット
    ラベル上の `Latch` チェックボックス対で Normal キーを包む（`&kp K`→`&sk K`/`&kt K`、
    キーはグリッドで選ぶ）。Hold と排他、ラッチ中はグリッドがキー専用。Caps Word /
    Key Repeat / Grave-Escape は Basic タブの単発タイル（2 列、最下段に None/Transparent）。
    付随して keymap-parser に `kt` 別名追加＋`gresc`→`Grave/Escape` 修正、fixtures に 3
    behavior 追加。残置 Basic チップ列は消滅。
  - `HidUsagePicker` のグリッド/タイル型を再利用。capability 連動。
- **Step 4（逆引きラベル）** — スロット面に「いまの組み合わせ＝◯◯」の控えめ表示、
  レイヤーサブモード（to/tog/sl）、カスタム hold-tap の identity 選択（§3b）。
- **Step 5 以降（要別設計）** — tier/カテゴリのタブ階層を撤去し「(a)＋(b)＋(c)」へ。
  Step 1-4 で方式が実用検証されてから別途設計。

## 6. capability 連動と非目標

- **全工程で capability 連動** — タイル/派生はファームが実際に公開する behavior に
  だけ出す。既存挙動（チップが `behaviors` 配列から描画）を崩さない。
- **ファーム/RPC 変更なし。** 出力は `BehaviorBinding` のまま。
- **新規 behavior を増やさない。** 既存 behavior の見せ方/操作の変更だけ。
- **Step ごとに最小差分。** 1 Step = 1 PR、ついで直しをしない。

## 7. upstream

「カテゴリ別タイルタブ」は特定ツール固有ではなく業界一般の確立された型。形になれば
upstream（[`zmkfirmware/zmk-studio`](https://github.com/zmkfirmware/zmk-studio)）への
提案候補。方向性は upstream [PR #159](https://github.com/zmkfirmware/zmk-studio/pull/159)
（Grid Picker for HID Usage）に近く要観察。フォーク固有のものはここに留め upstream
には出さない。

## 8. 未解決の問い

1. **`displayName` 一致の脆さ。** 派生全体がファーム供給の表示名に依存する。なお
   数値 `behaviorId` は安定な代替に**ならない**——ファームが実行時に割り当て、ビルド/
   キーボードごとに変わるのでハードコード不可。別の安定識別子（既知の behavior 名
   定数、metadata シグネチャ）で一致させられるか、`displayName` 文字列一致のまま名前
   差異時に穏当に劣化させるか。（現状の方向: 文字列一致＋「不在」の穏当劣化。）
2. **複数の hold-tap behavior。** `homerow_mods` と `&mt` が両方在るとき「キー＋修飾」
   の既定はどちらか、サブモード切替をどれだけ目立たせるか。
3. **「修飾ホールド・タップ空」ケース。** 空タップ＋修飾ホールドから `&kp <mod>` を
   派生するのは綺麗だがやや意外。逆引きラベルで足りるか、明示タイルにすべきか。
4. **Step 5 の範囲。** どちらの形にも収まらない behavior 用に、旧タブ階層を
   「上級者向け」退避口としてどれだけ残すか。
