import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadMusic() {
  const src = readFileSync(join(root, "src", "web", "app", "music.js"), "utf8");
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  sandbox.window = {};
  vm.runInContext(src, sandbox, { filename: "music.js" });
  const M = (sandbox.window as Record<string, unknown>).NeutronMusic as {
    freeAudio: {
      faEscapeLucene: (s: string) => string;
      faFreeLicense: (u: unknown) => boolean;
      faLicenseLabel: (u: unknown) => string;
      faParseArchiveSearch: (d: unknown) => Array<{
        kind: string; faid: string; identifier: string; title: string; artist: string; license: string; url: null
      }>;
      faPickMp3: (meta: unknown) => string | null;
      faParseJamendo: (d: unknown) => Array<{
        kind: string; faid: string; identifier: string; title: string; artist: string; album: string; url: string
      }>;
      FA_JAMENDO_KEY_LS: string;
    };
    _onNativeAudioEvent: (ev: string) => void;
  };
  expect(M, "window.NeutronMusic should be exported").toBeTruthy();
  expect(M.freeAudio, "freeAudio engine should be exported").toBeTruthy();
  return M;
}

describe("free music engine: Archive helpers", () => {
  it("escapes Lucene special characters in user queries", () => {
    const { faEscapeLucene } = loadMusic().freeAudio;
    expect(faEscapeLucene("lofi (chill) + beats?")).toBe("lofi \\(chill\\) \\+ beats\\?");
    expect(faEscapeLucene("plain words")).toBe("plain words");
    expect(faEscapeLucene("")).toBe("");
  });

  it("normalizes Archive.org advancedsearch payloads", () => {
    const { faParseArchiveSearch } = loadMusic().freeAudio;
    const tracks = faParseArchiveSearch({
      response: {
        docs: [
          { identifier: "some-lofi-tape", title: "Some Lofi Tape", creator: "Tape Maker", licenseurl: "https://creativecommons.org/licenses/by-nc-nd/3.0/" },
          { identifier: "no-title-item", licenseurl: "http://creativecommons.org/publicdomain/zero/1.0/" },
          { identifier: "unlicensed-upload", title: "Commercial Rip", creator: "Uploader" }, // skipped: no license
          { identifier: "weird-license", title: "Weird", licenseurl: "https://example.com/all-rights-reserved" }, // skipped
          { identifier: "" }, // skipped
          null, // skipped
        ],
      },
    });
    expect(tracks).toEqual([
      {
        kind: "archive",
        faid: "fa:archive:some-lofi-tape",
        identifier: "some-lofi-tape",
        title: "Some Lofi Tape",
        artist: "Tape Maker",
        license: "https://creativecommons.org/licenses/by-nc-nd/3.0/",
        url: null,
      },
      {
        kind: "archive",
        faid: "fa:archive:no-title-item",
        identifier: "no-title-item",
        title: "no-title-item",
        artist: "",
        license: "http://creativecommons.org/publicdomain/zero/1.0/",
        url: null,
      },
    ]);
  });

  it("faFreeLicense accepts CC/public-domain URLs and rejects the rest", () => {
    const { faFreeLicense } = loadMusic().freeAudio;
    expect(faFreeLicense("https://creativecommons.org/licenses/by/4.0/")).toBe(true);
    expect(faFreeLicense("http://creativecommons.org/licenses/by-nc-nd/3.0/")).toBe(true);
    expect(faFreeLicense("https://creativecommons.org/publicdomain/zero/1.0/")).toBe(true);
    expect(faFreeLicense("")).toBe(false);
    expect(faFreeLicense(null)).toBe(false);
    expect(faFreeLicense("https://example.com/all-rights-reserved")).toBe(false);
  });

  it("returns [] for garbage Archive payloads", () => {
    const { faParseArchiveSearch } = loadMusic().freeAudio;
    expect(faParseArchiveSearch(null)).toEqual([]);
    expect(faParseArchiveSearch({})).toEqual([]);
    expect(faParseArchiveSearch({ response: { docs: "nope" } })).toEqual([]);
  });

  it("faLicenseLabel shortens license URLs for display", () => {
    const { faLicenseLabel } = loadMusic().freeAudio;
    expect(faLicenseLabel("https://creativecommons.org/licenses/by-nc-nd/3.0/")).toBe("CC BY-NC-ND 3.0");
    expect(faLicenseLabel("http://creativecommons.org/licenses/by/4.0/")).toBe("CC BY 4.0");
    expect(faLicenseLabel("https://creativecommons.org/publicdomain/zero/1.0/")).toBe("CC0");
    expect(faLicenseLabel("https://creativecommons.org/publicdomain/mark/1.0/")).toBe("Public domain");
    expect(faLicenseLabel("")).toBe("Licensed");
  });

  it("picks the best mp3 from Archive metadata", () => {
    const { faPickMp3 } = loadMusic().freeAudio;
    const url = faPickMp3({
      metadata: { identifier: "some-lofi-tape" },
      files: [
        { name: "some-lofi-tape_spectrogram.png" },
        { name: "some-lofi-tape_vbr.mp3" },
        { name: "some-lofi-tape.mp3" },
        { name: "notes.txt" },
      ],
    });
    expect(url).toBe("https://archive.org/download/some-lofi-tape/some-lofi-tape.mp3");
  });

  it("falls back to the derivative mp3 when no original exists", () => {
    const { faPickMp3 } = loadMusic().freeAudio;
    expect(
      faPickMp3({
        metadata: { identifier: "abc" },
        files: [{ name: "abc_vbr.mp3" }],
      }),
    ).toBe("https://archive.org/download/abc/abc_vbr.mp3");
  });

  it("returns null when no mp3 is available", () => {
    const { faPickMp3 } = loadMusic().freeAudio;
    expect(faPickMp3({ metadata: { identifier: "abc" }, files: [{ name: "a.ogg" }] })).toBeNull();
    expect(faPickMp3(null)).toBeNull();
    expect(faPickMp3({})).toBeNull();
  });
});

describe("free music engine: Jamendo helpers", () => {
  it("normalizes Jamendo v3.0 /tracks payloads", () => {
    const { faParseJamendo } = loadMusic().freeAudio;
    const tracks = faParseJamendo({
      headers: { status: "success" },
      results: [
        {
          id: "12345",
          name: "Neon Drive",
          artist_name: "Vector Seven",
          album_name: "Midnight",
          audio: "https://prod-1.storage.jamendo.com/track.mp3",
        },
        { id: "no-audio", name: "Silent" }, // skipped: no audio URL
        null, // skipped
      ],
    });
    expect(tracks).toEqual([
      {
        kind: "jamendo",
        faid: "fa:jamendo:12345",
        identifier: "12345",
        title: "Neon Drive",
        artist: "Vector Seven",
        album: "Midnight",
        url: "https://prod-1.storage.jamendo.com/track.mp3",
      },
    ]);
  });

  it("returns [] for garbage Jamendo payloads", () => {
    const { faParseJamendo } = loadMusic().freeAudio;
    expect(faParseJamendo(null)).toEqual([]);
    expect(faParseJamendo({})).toEqual([]);
    expect(faParseJamendo({ results: "nope" })).toEqual([]);
  });

  it("exposes the Jamendo key storage name", () => {
    const { FA_JAMENDO_KEY_LS } = loadMusic().freeAudio;
    expect(FA_JAMENDO_KEY_LS).toBe("neutron_jamendo_client_id");
  });
});

describe("free music engine: native event hook", () => {
  it("exposes _onNativeAudioEvent for the Android bridge", () => {
    const M = loadMusic();
    expect(typeof M._onNativeAudioEvent).toBe("function");
    // Must not throw when no track is active (activeEngine is "yt").
    expect(() => M._onNativeAudioEvent("ended")).not.toThrow();
    expect(() => M._onNativeAudioEvent("error")).not.toThrow();
  });
});
