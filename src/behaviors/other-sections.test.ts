import { describe, expect, it } from "vitest";

import {
  CONSUMER_MEDIA_IDS,
  OTHER_SECTION_ORDER,
  otherSectionTitle,
} from "./other-sections";

describe("otherSectionTitle", () => {
  it("groups every page-7 keyboard/keypad usage together", () => {
    expect(otherSectionTitle("Keyboard Execute", 7)).toBe("Keyboard / Keypad");
    expect(otherSectionTitle("Keypad Equal Sign", 7)).toBe("Keyboard / Keypad");
  });

  it("routes AL / AC application usages by prefix", () => {
    expect(otherSectionTitle("AL Calculator", 12)).toBe("Application Launch");
    expect(otherSectionTitle("AC Copy", 12)).toBe("Application Control");
  });

  it("groups telephony and contacts", () => {
    expect(otherSectionTitle("Contact Edited", 12)).toBe("Telephony & Contacts");
    expect(otherSectionTitle("Media Select Telephone", 12)).toBe("Telephony & Contacts");
  });

  it("groups display and camera", () => {
    expect(otherSectionTitle("Display Brightness", 12)).toBe("Display & Camera");
    expect(otherSectionTitle("Camera Access Toggle", 12)).toBe("Display & Camera");
  });

  it("groups audio", () => {
    expect(otherSectionTitle("Bass Boost", 12)).toBe("Audio");
    expect(otherSectionTitle("Channel Increment", 12)).toBe("Audio");
  });

  it("groups media & playback", () => {
    expect(otherSectionTitle("Tracking Increment", 12)).toBe("Media & Playback");
    expect(otherSectionTitle("Frame Forward", 12)).toBe("Media & Playback");
  });

  it("falls back to Other for anything unmatched", () => {
    expect(otherSectionTitle("Some Obscure Usage", 12)).toBe("Other");
  });

  it("only ever returns a title listed in OTHER_SECTION_ORDER", () => {
    const samples: [string, number][] = [
      ["Keyboard Help", 7],
      ["AL Email Reader", 12],
      ["AC Paste", 12],
      ["Contact Index", 12],
      ["Display Backlight Toggle", 12],
      ["Bass Increment", 12],
      ["Play/Pause", 12],
      ["Totally Unknown", 12],
    ];
    for (const [name, page] of samples) {
      expect(OTHER_SECTION_ORDER).toContain(otherSectionTitle(name, page));
    }
  });
});

describe("CONSUMER_MEDIA_IDS", () => {
  it("contains the core transport + volume keys", () => {
    expect(CONSUMER_MEDIA_IDS.has(176)).toBe(true); // Play
    expect(CONSUMER_MEDIA_IDS.has(183)).toBe(true); // Stop
    expect(CONSUMER_MEDIA_IDS.has(226)).toBe(true); // Mute
    expect(CONSUMER_MEDIA_IDS.has(233)).toBe(true); // Volume Increment
  });

  it("excludes the obscure long tail", () => {
    expect(CONSUMER_MEDIA_IDS.has(189)).toBe(false); // Tracking
    expect(CONSUMER_MEDIA_IDS.has(403)).toBe(false); // AL A/V Capture/Playback
  });
});
