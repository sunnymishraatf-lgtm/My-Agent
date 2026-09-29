/**
 * Voice-output speech tests: stopSpeechSynthesis() in src/web/app/ui-utils.js.
 * Pure helper behind the "stop talking on navigation" behavior — app.js
 * render() calls it on every route change so a reply never keeps reading
 * aloud after the user leaves the chat view.
 */
import { describe, it, expect, vi } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { stopSpeechSynthesis } = uiUtils;

function fakeWindow(cancelImpl?: (...args: unknown[]) => unknown) {
  return {
    window: {
      speechSynthesis: { cancel: cancelImpl || vi.fn() },
    },
  };
}

describe("stopSpeechSynthesis", () => {
  it("calls cancel() and returns true when speech is available", () => {
    const cancel = vi.fn();
    expect(stopSpeechSynthesis(fakeWindow(cancel))).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("returns false when speechSynthesis is missing", () => {
    expect(stopSpeechSynthesis({ window: {} })).toBe(false);
  });

  it("returns false when the window itself is missing", () => {
    expect(stopSpeechSynthesis({})).toBe(false);
    expect(stopSpeechSynthesis()).toBe(false);
  });

  it("returns false when cancel is not a function", () => {
    expect(stopSpeechSynthesis({ window: { speechSynthesis: {} } })).toBe(false);
  });

  it("never throws when cancel() throws", () => {
    const bad = vi.fn(() => { throw new Error("boom"); });
    expect(stopSpeechSynthesis(fakeWindow(bad))).toBe(false);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
