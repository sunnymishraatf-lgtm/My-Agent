/**
 * Router regression tests: currentRoute() must strip query strings so that
 * emailed links like #/verify?token=... and #/reset-password?token=...
 * reach their routes instead of falling back to the dashboard.
 *
 * currentRoute is internal to app.js, so the test extracts the function
 * source and evaluates it with stubbed location/ROUTES/window.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadCurrentRoute(): (hash: string) => string {
  const src = readFileSync(join(root, "src", "web", "app", "app.js"), "utf8");
  const m = src.match(/function currentRoute\(\) \{[\s\S]*?\n\}/);
  expect(m, "currentRoute found in app.js").not.toBeNull();
  const fnSrc = (m as RegExpMatchArray)[0] as string;
  const factory = new Function(
    "location",
    "ROUTES",
    "window",
    `${fnSrc}\nreturn currentRoute();`,
  ) as (location: { hash: string }, routes: Record<string, number>, w: object) => string;
  const routes = { dashboard: 1, verify: 1, "reset-password": 1, chat: 1, rooms: 1 };
  return (hash: string) => factory({ hash }, routes, {});
}

describe("currentRoute query-string handling", () => {
  it("routes emailed token links to their pages", () => {
    const currentRoute = loadCurrentRoute();
    expect(currentRoute("#/verify?token=abc123")).toBe("verify");
    expect(currentRoute("#/reset-password?token=abc123")).toBe("reset-password");
  });

  it("still routes plain hashes and deep links", () => {
    const currentRoute = loadCurrentRoute();
    expect(currentRoute("#/chat")).toBe("chat");
    expect(currentRoute("#/verify")).toBe("verify");
    expect(currentRoute("")).toBe("dashboard");
    expect(currentRoute("#/nope")).toBe("dashboard");
    expect(currentRoute("#room=NEUTRON-ABC123")).toBe("rooms");
  });
});
