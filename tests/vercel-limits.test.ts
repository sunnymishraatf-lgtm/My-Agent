/**
 * Vercel deployment limits guard.
 *
 * The Vercel Hobby plan enforces a hard limit of 12 serverless functions per
 * deployment ("No more than 12 Serverless Functions can be added to a
 * Deployment on the Hobby plan"). Every .js file under api/ (recursively)
 * becomes one function, and exceeding the cap fails the deployment AFTER a
 * green build — easy to miss. This test fails the suite before that happens.
 *
 * Rule: to add an endpoint when at 12, fold it into an existing function
 * (e.g. GET+POST in one file) instead of adding a new file under api/.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const VERCEL_HOBBY_FUNCTION_LIMIT = 12;

function collect(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, ext, out);
    } else if (entry.endsWith(ext) && !entry.startsWith("_")) {
      out.push(full);
    }
  }
  return out;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("vercel deployment limits", () => {
  it(`api/ holds at most ${VERCEL_HOBBY_FUNCTION_LIMIT} serverless functions`, () => {
    const functions = collect(join(repoRoot, "api"), ".js");
    expect(functions.length).toBeLessThanOrEqual(VERCEL_HOBBY_FUNCTION_LIMIT);
  });

  it("every api-src route has a committed bundle", () => {
    // The bundler auto-discovers api-src/**/*.ts into api/**/*.js and the
    // bundles are committed (Vercel snapshots api/ before the build).
    // A missing bundle would 404 the route in production.
    const srcDir = join(repoRoot, "api-src");
    const outDir = join(repoRoot, "api");
    const missing: string[] = [];
    for (const src of collect(srcDir, ".ts")) {
      const rel = relative(srcDir, src).slice(0, -3) + ".js";
      if (!existsSync(join(outDir, rel.split(sep).join("/")))) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });
});
