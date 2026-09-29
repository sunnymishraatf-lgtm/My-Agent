// Publishes the curated Hermes skill library as static files for the web app:
//   src/server/agent/skills/*.md -> dist/web/skills/*.md  (+ index.json)
// dist/web is the static root: the Vercel project uses outputDirectory
// dist/web, and the local Node server serves /src/web/* from it. The app
// fetches /src/web/skills/*, which resolves on both (Vercel's catch-all
// rewrite /src/web/:path* -> /:path*; the Node server's /src/web/ handler).
// A copy is also kept at public/skills/ for the legacy public/ layout.
// The Skills browser in the app fetches these — no server needed, so it
// works on the serverless deployment and offline after first load.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "server", "agent", "skills");
// Primary: dist/web is the static root (Vercel outputDirectory + local server).
const to = join(root, "dist", "web", "skills");
// Legacy compat copy (public/ layout used by build:vercel).
const toLegacy = join(root, "public", "skills");

function parseFrontmatter(content) {
  let name = "", description = "";
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      for (const line of content.slice(3, end).split("\n")) {
        const m = line.match(/^\s*(name|description)\s*:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/);
        if (m) {
          const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
          if (m[1] === "name") name = value;
          else description = value;
        }
      }
    }
  }
  return { name, description };
}

if (!existsSync(from)) {
  console.error("copy-skills-web: " + from + " not found");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
rmSync(toLegacy, { recursive: true, force: true });
mkdirSync(toLegacy, { recursive: true });

const files = readdirSync(from).filter((f) => f.endsWith(".md")).sort();
const index = [];
for (const file of files) {
  const content = readFileSync(join(from, file), "utf8");
  const { name, description } = parseFrontmatter(content);
  cpSync(join(from, file), join(to, file));
  cpSync(join(from, file), join(toLegacy, file));
  index.push({
    name: name || file.replace(/\.md$/, ""),
    description: description || "(no description)",
    file,
  });
}
index.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(join(to, "index.json"), JSON.stringify(index, null, 1));
writeFileSync(join(toLegacy, "index.json"), JSON.stringify(index, null, 1));
console.log(`copy-skills-web: published ${index.length} skills to dist/web/skills/ (+ public/skills/)`);
