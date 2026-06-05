# Key-picker rethink: derive the behavior from filled slots

> Internal design note for [issue #16](https://github.com/numachang/zmk-studio-tweaks/issues/16).
> This expands the issue with codebase-grounded detail (file paths, component
> names, the data model, edge cases) and a per-step implementation plan. The
> issue is the user-facing summary; this note is the working design. English is
> authoritative; a Japanese mirror follows below.
>
> Status: **design only — no implementation yet.** Direction is reviewable here
> before any code lands.

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

What a person holds in their head is *"what's on tap, what's on hold"* — not the
name `&mt`. For the typing + layer + hold-tap core (≈90% of real keymaps) the
behavior follows mechanically from which slots are filled:

| Tap slot       | Hold slot | Derived behavior              | Firmware                         |
| -------------- | --------- | ----------------------------- | -------------------------------- |
| key            | (empty)   | Key Press                     | `&kp <key>`                      |
| key            | modifier  | Mod-Tap                       | `&mt <mod> <key>`                |
| key            | layer     | Layer-Tap                     | `&lt <layer> <key>`              |
| (empty / None) | layer     | Momentary Layer               | `&mo <layer>`                    |
| (empty)        | modifier  | a plain held modifier         | `&kp <mod>` (e.g. `&kp LSHIFT`)  |
| (empty)        | (empty)   | None                          | `&none`                          |

In this range the **behavior selector is unnecessary**: fill the two slots and
the name is determined. The parameter panel already exposes Hold / Tap tabs, so
half the groundwork exists. The change is an inversion of order:

> "pick a behavior, then fill Hold/Tap" → **"fill Hold/Tap, and the behavior is derived."**

Note the two `&kp` rows: a key on tap with nothing held is `&kp <key>`, and a
modifier held with nothing on tap is also a `&kp` — just with a modifier keycode.
Mod-Tap only appears when **both** slots are filled (a real key on tap *and* a
modifier on hold). The reverse-lookup label (§3b) is what keeps this legible.

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

### (c) Parameterised tiles — one tile, one parameter

`&sk` (sticky key) and `&kt` (key toggle) take a single key/mod parameter, so they
are **not** "one tile = one binding": pressing the tile then needs a key chosen.
Model them as a tile that reveals a single-key picker (equivalently, a "tap-only"
degenerate of the slot surface). Calling them tile-select would be a category
error. (See the appendix for what these flavor behaviors actually do.)

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
- **Modifier detection must decode ZMK's implicit-modifier encoding, not just
  match eight base usages.** A held value is "a modifier" not only when it is one
  of the eight base HID modifier usages (L/R Ctrl/Shift/Alt/GUI), but also when it
  is any keycode carrying implicit modifier bits — ZMK packs modifiers into the
  high bits of the usage value (`LC(...)`, `LS(LALT)`, `LC(LSHFT)`, …), so users
  routinely put **multiple** modifiers on hold. Matching only the eight base
  usages would make `bindingToSlots` drop those holds and break the round trip.
  Detection (and the hold-slot composite picker, §3b) must understand the
  implicit-modifier encoding so a multi-modifier hold survives binding → slots →
  binding intact.

No firmware/RPC changes: the output is still a `BehaviorBinding`
`{ behaviorId, param1, param2 }` handed to the existing `doUpdateBinding`.

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
  a faint **∅ cap = None**, a **▽ cap = Transparent** (a fully blank cap read as a
  rendering gap, so the glyph is drawn faintly instead).
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

- **Goal:** implement `deriveBinding` / `bindingToSlots` (§4) and let the user
  fill Hold / Tap slots instead of naming a behavior, for the four core
  behaviors. The Hold/Tap tabs in
  [`BehaviorParametersPicker.tsx`](../../src/behaviors/BehaviorParametersPicker.tsx)
  become the *primary* surface; the derived name is shown, not chosen.
- **Risk:** medium — two distinct hazards:
  - *Round-trip fidelity.* The **binding** survives binding → slots → binding, but
    the **slot decomposition is heuristic**: which slot `&kp LSHIFT` lands in is
    inferred from the keycode's type (a lone modifier → hold, a regular key → tap),
    not stored anywhere. Describe Step 2 as "binding-lossless," not "slot-lossless."
    Vitest should assert both the round trip *and* that `deriveBinding`'s output
    passes the existing `validateBinding` (call site
    [`BehaviorBindingPicker.tsx`](../../src/behaviors/BehaviorBindingPicker.tsx)
    lines 227-234) so derived bindings can never be rejected by the firmware path.
  - *Dual-edit state sync (the migration hazard).* Because the old chip row stays
    until Step 5, the same binding becomes editable two ways — by chip and by slot.
    On top of the existing `binding` prop and local `behaviorId/param1/param2` state
    (lines 210-247), slot state is a third source of truth, and the chip↔slot
    interaction (clicking the "Mod-Tap" chip vs. filling the hold slot) must stay
    consistent. To contain this, **hide the chips for the derivation-target
    behaviors** (`&kp`/`&mt`/`&lt`/`&mo`) as soon as the slot surface owns them,
    rather than leaving both live and three-way-syncing.
- **Done when:** filling/clearing the Hold and Tap slots produces the correct one
  of `&kp` / `&mt` / `&lt` / `&mo` / `&none`, opening an existing such key shows the
  right slot contents, and the derived binding validates.

### Step 3 — tile-ify the single-action behaviors

- **Goal:** turn Mouse / Bluetooth / Output / External Power / System (and the
  parameterless `&caps_word` / `&key_repeat` / `&gresc`) into category tabs of
  tiles; fold media into the Key Press surface (page 12, §3a); give `&sk` / `&kt`
  the parameterised-tile treatment (shape (c), §3); collapse the Basic chip row.
- **Risk:** medium — mostly UI; reuses the grid/tile patterns from
  [`HidUsagePicker.tsx`](../../src/behaviors/HidUsagePicker.tsx). Capability-aware:
  a tab/tile renders only for behaviors the firmware exposes.

### Step 4 — reverse-lookup label + layer sub-mode picker

- **Goal:** add the unobtrusive "current combination = X" label to the slot
  surface, plus the layer sub-mode picker (`&to` / `&tog` / `&sl`) and the
  custom-hold-tap identity choice (§3b).
- **Risk:** low-medium — additive labels and a small selector.

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
   is the default for a "key + mod" slot fill, and how prominent should the
   sub-mode switch be?
3. **The "hold a modifier, empty tap" case.** Deriving `&kp <mod>` from an empty
   tap + a held modifier is elegant but slightly surprising; does the reverse-
   lookup label make it clear enough, or should that case stay an explicit tile?
4. **Step 5 scope.** How much of the old tab hierarchy, if any, should survive as
   an "advanced" escape hatch for behaviors that don't fit either shape?

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
> ステータス: **設計のみ・実装はまだ。** コードを書く前にここで方向性をレビュー可能に。

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

人の頭にあるのは「タップに何、ホールドに何」であって `&mt` という名前ではない。
タイピング＋レイヤー＋ホールドタップの中核（実キーマップの約 9 割）では、どの枠を
埋めたかから behavior が機械的に決まる:

| タップ枠   | ホールド枠 | 派生 behavior     | ファーム                        |
| ---------- | ---------- | ----------------- | ------------------------------- |
| キー       | （空）     | Key Press         | `&kp <key>`                     |
| キー       | 修飾       | Mod-Tap           | `&mt <mod> <key>`               |
| キー       | レイヤー   | Layer-Tap         | `&lt <layer> <key>`             |
| （空/None）| レイヤー   | Momentary Layer   | `&mo <layer>`                   |
| （空）     | 修飾       | ただの修飾キー    | `&kp <mod>`（例 `&kp LSHIFT`）  |
| （空）     | （空）     | None              | `&none`                         |

この範囲では **behavior セレクタは不要**——2 枠を埋めれば名前は決まる。やることは
順序の反転:「behavior を選んでから Hold/Tap を埋める」→「**Hold/Tap を埋めれば
behavior が派生する**」。`&kp` が 2 行ある点に注意（タップにキー＝`&kp <key>`、
ホールドに修飾だけ＝`&kp <mod>`）。Mod-Tap は**両枠**が埋まったときだけ現れる。
逆引きラベル（§3b）がこの可読性を担保する。

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

### (c) パラメータ付きタイル — 1 タイル＋param 1 つ

`&sk`（sticky key）と `&kt`（key toggle）はキー/修飾 param を 1 つ取るので「1 タイル
＝完成」では**ない**: タイルを押した後にキー選択が要る。タイルを押すと単一キー
ピッカーが現れる形（＝スロット面の「タップのみ」退化形）でモデル化する。タイル選択型
に入れるのはカテゴリ誤り。（小物 behavior の挙動は付録参照。）

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
  描画し、選ぶ動作が「キーを選ぶ」のと同じに見えるようにする（薄い **∅ キャップ＝
  None**、**▽ キャップ＝Transparent**。完全ブランクは描画抜けに見えるのでグリフを薄く
  出す）。
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
- **Step 3（タイル化）** — Mouse / Bluetooth / Output / External Power / System
  （と param なしの caps_word/key_repeat/gresc）をカテゴリタブのタイルに。メディアは
  Key Press 面（page 12, §3a）へ内包。`&sk` / `&kt` はパラメータ付きタイル（shape (c),
  §3）に。Basic チップ列を畳む。`HidUsagePicker` のグリッド/タイル型を再利用。
  capability 連動。
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
