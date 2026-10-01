/**
 * Friends system + persistent storage mirror tests.
 * Structural checks (no DOM): friends.js exposes the right API, the route
 * and sidebar are wired, rooms.js exposes the programmatic APIs friends
 * needs, and app.js contains the native storage mirror.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "web", "app");
const appJs = readFileSync(join(root, "app.js"), "utf8");
const friendsJs = readFileSync(join(root, "friends.js"), "utf8");
const roomsJs = readFileSync(join(root, "rooms.js"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "styles.css"), "utf8");

describe("friends wiring", () => {
  it("friends.js exposes the NeutronFriends API", () => {
    expect(friendsJs).toContain("window.NeutronFriends");
    expect(friendsJs).toContain("renderFriends");
    expect(friendsJs).toContain("listFriends");
    expect(friendsJs).toContain("neutron_friends");
  });

  it("friends.js supports add / call / invite / remove", () => {
    expect(friendsJs).toContain("Add friend");
    expect(friendsJs).toContain("callPerson");
    expect(friendsJs).toContain("invitePerson");
    expect(friendsJs).toContain("shareText"); // native share sheet for invites
  });

  it("the friends route is registered in app.js", () => {
    expect(appJs).toMatch(/friends:\s*function\s*\(view\)/);
    expect(appJs).toContain("NeutronFriends.renderFriends");
  });

  it("the sidebar links to #/friends and friends.js is loaded", () => {
    expect(html).toContain('href="#/friends"');
    expect(html).toContain('data-route="friends"');
    expect(html).toContain('src="/src/web/app/friends.js"');
  });

  it("rooms.js exposes the programmatic APIs friends needs", () => {
    expect(roomsJs).toContain("createRelayRoom");
    expect(roomsJs).toContain("openRelayRoom");
    expect(roomsJs).toContain("inviteLink");
    expect(roomsJs).toContain("joinVoice");
  });

  it("friends styles exist", () => {
    expect(css).toContain(".friend-list");
    expect(css).toContain(".friend-row");
    expect(css).toContain(".friend-actions");
  });
});

describe("persistent storage mirror", () => {
  it("app.js mirrors localStorage to the native bridge", () => {
    expect(appJs).toContain("__neutronMirrored");
    expect(appJs).toContain("nativeSave");
    expect(appJs).toContain("nativeLoad");
    expect(appJs).toContain("nativeRemove");
  });

  it("the mirror patches the localStorage instance, not the Storage prototype", () => {
    // Patching the prototype would also affect sessionStorage semantics.
    expect(appJs).not.toContain("Storage.prototype.setItem =");
    expect(appJs).toContain("ls.setItem = function");
  });

  it("the mirror runs before any other localStorage use", () => {
    const mirrorPos = appJs.indexOf("__neutronMirrored");
    const firstUse = appJs.indexOf("localStorage.getItem", mirrorPos + 100);
    expect(mirrorPos).toBeGreaterThan(-1);
    expect(firstUse).toBeGreaterThan(mirrorPos);
    // And the mirror block is near the top of the file (first 5% of chars).
    expect(mirrorPos).toBeLessThan(appJs.length * 0.05);
  });
});
