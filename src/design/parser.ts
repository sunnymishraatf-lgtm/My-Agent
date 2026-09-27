import type { DesignSystem, DesignSystemJson, DesignTheme } from "./design";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSections(md: string, prefix: string): Map<string, string> {
  const sections = new Map<string, string>();
  const re = new RegExp(`^${prefix}\\s+(.+?)\\s*$`);
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current === null) return;
    const body = buf.join("\n");
    // Duplicate headings merge instead of silently dropping the earlier body.
    const prev = sections.get(current);
    sections.set(current, prev !== undefined ? `${prev}\n${body}` : body);
    buf.length = 0;
  };
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      flush();
      current = m[1]!.trim();
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function sections(md: string): Map<string, string> {
  // Section lookup is case-insensitive.
  const out = new Map<string, string>();
  for (const [name, body] of splitSections(md, "##")) {
    const key = name.toLowerCase();
    const prev = out.get(key);
    out.set(key, prev !== undefined ? `${prev}\n${body}` : body);
  }
  return out;
}

export function sectionContent(md: string, heading: string): string {
  return sections(md).get(heading.toLowerCase()) ?? "";
}

export function listItems(content: string): string[] {
  if (!content) return [];
  return content
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"));
}

export function nextLineValue(content: string, key: string): string | undefined {
  if (!content) return undefined;
  const esc = escapeRe(key);
  const same = content.match(new RegExp(`^${esc}:\\s*(\\S.*?)\\s*$`, "im"));
  if (same?.[1]) return same[1].trim();
  const next = content.match(new RegExp(`^${esc}:\\s*\\r?\\n+\\s*(.+?)\\s*$`, "im"));
  if (next?.[1]) return next[1].trim();
  return undefined;
}

function normalizeColorKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

function parseColorsSection(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!content) return out;
  const subs = splitSections(content, "###");
  for (const [name, body] of subs) {
    const hex = body.match(/#[0-9a-fA-F]{3,8}/);
    if (hex) out[normalizeColorKey(name)] = hex[0]!.toUpperCase();
  }
  // Also accept bullet lines such as "- Primary: #FF0000".
  for (const m of content.matchAll(/^\s*(?:[-*•]\s*)?([A-Za-z0-9 ]+?)\s*:\s*(#[0-9a-fA-F]{3,8})\s*$/gm)) {
    out[normalizeColorKey(m[1]!)] = m[2]!.toUpperCase();
  }
  return out;
}

function parseNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/px/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

function parseSpacing(content: string): number[] {
  if (!content) return [];
  const line = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^\d+px(\s*\/\s*\d+px|\s+\d+px)+$/.test(l));
  if (!line) return [];
  return line.match(/\d+/g)?.map(Number) ?? [];
}

function parseSubsectionList(content: string): Array<{ name: string; description: string }> {
  if (!content) return [];
  const subs = splitSections(content, "###");
  if (subs.size === 0) {
    return listItems(content).map((n) => ({ name: n, description: "" }));
  }
  return [...subs.entries()].map(([name, body]) => ({ name, description: body.trim() }));
}

function parseResponsive(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, body] of splitSections(content, "###")) {
    out[name.toLowerCase()] = body.trim();
  }
  return out;
}

function parseGrid(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!content) return out;
  for (const m of content.matchAll(/^\s*([A-Za-z]+)\s*:\s*(\d+)\s*(?:columns)?\s*$/gim)) {
    out[m[1]!.toLowerCase()] = m[2]!;
  }
  return out;
}

function parseLayoutType(spec: string): string {
  const v = (spec ?? "").toLowerCase();
  if (v.includes("sidebar")) return "sidebar";
  if (v.includes("top") || v.includes("header") || v.includes("navbar")) return "topnav";
  if (v.includes("center")) return "centered";
  return "sidebar";
}

export function parseDesignSystem(md: string, sourcePath = "design.md"): DesignSystem {
  const colorMap = parseColorsSection(sectionContent(md, "Colors"));
  const typographySection = sectionContent(md, "Typography");

  const out: DesignSystem = {
    project:
      nextLineValue(sectionContent(md, "Project"), "Name") ??
      nextLineValue(sectionContent(md, "Project"), "Project") ??
      "",
    vision: sectionContent(md, "Vision"),
    users: sectionContent(md, "Users"),
    features: listItems(sectionContent(md, "Core Features")),
    pages: parseSubsectionList(sectionContent(md, "Pages")),
    flow: listItems(sectionContent(md, "User Flow")),
    uiux:
      sectionContent(md, "UI / UX") ||
      sectionContent(md, "UI/UX") ||
      sectionContent(md, "Design Direction"),
    colors: {
      primary: colorMap["primary"],
      secondary: colorMap["secondary"],
      background: colorMap["background"],
      surface: colorMap["surface"],
      card: colorMap["card"],
      text: colorMap["text"],
      mutedText: colorMap["mutedtext"] ?? colorMap["muted"],
      border: colorMap["border"],
      success: colorMap["success"],
      warning: colorMap["warning"],
      error: colorMap["error"],
    },
    typography: {
      font:
        nextLineValue(typographySection, "Font family") ??
        nextLineValue(typographySection, "Font") ??
        nextLineValue(typographySection, "Body font"),
      heading: nextLineValue(typographySection, "Heading font") ?? nextLineValue(typographySection, "Heading"),
      body: nextLineValue(typographySection, "Body font") ?? nextLineValue(typographySection, "Body"),
      headingWeights: nextLineValue(typographySection, "Heading weights") ?? nextLineValue(typographySection, "Heading weight"),
      bodyWeight: nextLineValue(typographySection, "Body weight"),
    },
    layout: {
      maxWidth: nextLineValue(sectionContent(md, "Layout"), "Maximum content width"),
      pageLayout: nextLineValue(sectionContent(md, "Layout"), "Page layout"),
      sidebarWidth: nextLineValue(sectionContent(md, "Layout"), "Sidebar width"),
      headerHeight: nextLineValue(sectionContent(md, "Layout"), "Header height"),
      contentPadding: nextLineValue(sectionContent(md, "Layout"), "Content padding"),
    },
    grid: parseGrid(sectionContent(md, "Grid")),
    spacing: parseSpacing(sectionContent(md, "Spacing")),
    radius: {
      button: nextLineValue(sectionContent(md, "Border Radius"), "Buttons"),
      card: nextLineValue(sectionContent(md, "Border Radius"), "Cards"),
      inputs: nextLineValue(sectionContent(md, "Border Radius"), "Inputs"),
    },
    shadows: listItems(sectionContent(md, "Shadows")),
    components: parseSubsectionList(sectionContent(md, "Components")),
    responsive: parseResponsive(sectionContent(md, "Responsive Design")),
    animations: listItems(sectionContent(md, "Animations")),
    icons:
      nextLineValue(sectionContent(md, "Icons"), "Icon library") ??
      nextLineValue(sectionContent(md, "Icons"), "Icons"),
    images: sectionContent(md, "Images"),
    accessibility: listItems(sectionContent(md, "Accessibility")),
    doNot: listItems(sectionContent(md, "Do Not")),
    frontend: {
      framework: nextLineValue(sectionContent(md, "Frontend"), "Framework") ?? "",
      componentLibrary:
        nextLineValue(sectionContent(md, "Frontend"), "Component library") ??
        nextLineValue(sectionContent(md, "Frontend"), "Component"),
    },
    backend: {
      framework: nextLineValue(sectionContent(md, "Backend"), "Framework"),
      apiStyle:
        nextLineValue(sectionContent(md, "Backend"), "API style") ??
        nextLineValue(sectionContent(md, "Backend"), "API"),
    },
    database: {
      database:
        nextLineValue(sectionContent(md, "Database"), "Database") ??
        nextLineValue(sectionContent(md, "Backend"), "Database"),
      entities:
        nextLineValue(sectionContent(md, "Database"), "Main entities") ??
        nextLineValue(sectionContent(md, "Database"), "Entities"),
    },
    authentication: sectionContent(md, "Authentication"),
    security: sectionContent(md, "Security"),
    integrations: sectionContent(md, "Integrations"),
    acceptanceCriteria: listItems(sectionContent(md, "Acceptance Criteria")),
    warnings: [],
    raw: md,
    parsedAt: new Date().toISOString(),
  };

  out.warnings = validateDesign(out, sourcePath);
  return out;
}

function validateDesign(d: DesignSystem, source: string): string[] {
  const warnings: string[] = [];
  if (!d.colors.primary) warnings.push(`${source}: missing Primary color`);
  if (!d.colors.background) warnings.push(`${source}: missing Background color`);
  if (!d.colors.text) warnings.push(`${source}: missing Text color`);
  if (!d.typography.font) warnings.push(`${source}: missing Typography`);
  if (!d.layout.pageLayout) warnings.push(`${source}: missing Layout definition`);
  if (!d.responsive.mobile) warnings.push(`${source}: missing Mobile responsive definition`);
  if (!d.responsive.desktop) warnings.push(`${source}: missing Desktop responsive definition`);
  if (d.components.length === 0) warnings.push(`${source}: missing Component styles`);
  return warnings;
}

export function toDesignSystemJson(d: DesignSystem): DesignSystemJson {
  const theme: DesignTheme = (() => {
    const t = (d.uiux + " " + d.raw.slice(0, 2000)).toLowerCase();
    if (t.includes("light + dark") || t.includes("light+dark") || t.includes("allow theme switching")) return "system";
    if (t.includes("dark")) return "dark";
    if (t.includes("light")) return "light";
    return "system";
  })();

  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.colors)) {
    if (v) colors[k === "mutedText" ? "muted" : k] = v;
  }

  return {
    theme,
    colors,
    layout: {
      type: parseLayoutType(d.layout.pageLayout ?? ""),
      sidebarWidth: parseNumber(d.layout.sidebarWidth),
      headerHeight: parseNumber(d.layout.headerHeight),
      maxWidth: parseNumber(d.layout.maxWidth),
    },
    typography: {
      font: d.typography.font ?? d.typography.heading ?? "Inter",
    },
    radius: {
      card: parseNumber(d.radius.card ?? d.radius.inputs),
      button: parseNumber(d.radius.button),
    },
    spacing: d.spacing.length ? d.spacing : [4, 8, 12, 16, 24, 32, 48, 64],
    components: d.components,
    responsive: d.responsive,
    features: d.features,
    pages: d.pages,
    warnings: d.warnings,
    raw: d.raw,
  };
}

export function designSystemToCssTokens(json: DesignSystemJson): string {
  const lines: string[] = [];
  lines.push(":root {");
  for (const [k, v] of Object.entries(json.colors)) {
    if (v) lines.push(`  --color-${k}: ${v};`);
  }
  if (json.layout.sidebarWidth) lines.push(`  --layout-sidebar-width: ${json.layout.sidebarWidth}px;`);
  if (json.layout.headerHeight) lines.push(`  --layout-header-height: ${json.layout.headerHeight}px;`);
  if (json.layout.maxWidth) lines.push(`  --layout-max-width: ${json.layout.maxWidth}px;`);
  if (json.radius.card) lines.push(`  --radius-card: ${json.radius.card}px;`);
  if (json.radius.button) lines.push(`  --radius-button: ${json.radius.button}px;`);
  for (const s of json.spacing) {
    lines.push(`  --space-${s}: ${s}px;`);
  }
  lines.push("}");
  return lines.join("\n");
}