// Categorisation helpers for the keycode picker's "Other" catch-all (issue #16,
// Step 3a). Kept in their own module so the pure logic is unit-testable without
// pulling in the React picker.

// Consumer (HID page 0x0C) media keys worth promoting out of the "Other"
// catch-all onto the Apps/Media/Special tab — the transport + volume controls a
// keymap author actually binds. The long tail of consumer usages (app launch,
// app control, contacts, …) stays in Other, reachable via search.
export const CONSUMER_PAGE = 12;
export const CONSUMER_MEDIA_IDS: ReadonlySet<number> = new Set([
  176, 177, 178, 179, 180, 181, 182, 183, 184, 185, // Play … Random Play
  204, 205, 206, // Stop/Eject, Play/Pause, Play/Skip
  224, 226, 233, 234, // Volume, Mute, Volume Inc/Dec
]);

// The "Other" combobox is a long catch-all; group it into labelled sections so
// it's navigable. The grouping is derived from the usage (page + name prefix) —
// the HID spec doesn't give these a finer category, so this is a pragmatic
// heuristic kept in one place. Section order is defined by OTHER_SECTION_ORDER.
export const OTHER_SECTION_ORDER = [
  "Keyboard / Keypad",
  "Media & Playback",
  "Audio",
  "Display & Camera",
  "Application Launch",
  "Application Control",
  "Telephony & Contacts",
  "Other",
] as const;

export type OtherSection = (typeof OTHER_SECTION_ORDER)[number];

/** Pick the section a leftover "Other" usage belongs to (page + name heuristic). */
export function otherSectionTitle(name: string, pageId: number): OtherSection {
  if (pageId === 7) return "Keyboard / Keypad";
  if (name.startsWith("AL ")) return "Application Launch";
  if (name.startsWith("AC ")) return "Application Control";
  if (name.startsWith("Contact ") || /Phone|Dial|Telephone/.test(name))
    return "Telephony & Contacts";
  if (/Display|Camera|Brightness|Backlight|Illumination|Privacy Screen/.test(name))
    return "Display & Camera";
  if (/Volume|Mute|Bass|Treble|Balance|Speaker|Channel|Loudness|Surround|Audio/.test(name))
    return "Audio";
  if (/Play|Pause|Record|Rewind|Forward|Track|Stop|Eject|Repeat|Frame|Speed|Mark/.test(name))
    return "Media & Playback";
  return "Other";
}
