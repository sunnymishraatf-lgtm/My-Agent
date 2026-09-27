import { describe, it, expect } from "vitest";
import { parseDesignSystem, toDesignSystemJson, designSystemToCssTokens } from "../src/design/parser";

describe("parseDesignSystem", () => {
  const minimal = `# Design

## Project

Name: TestApp

## Core Features

- Login
- Dashboard

## Pages

### Dashboard

Shows stats.

## Colors

### Primary

#7C3AED

### Background

#09090B

### Text

#FAFAFA

## Typography

Font family: Inter

## Layout

Maximum content width: 1280px
Page layout: Sidebar + main content

## Responsive Design

### Desktop

Full width.

### Mobile

Drawer.

## Frontend

Framework: React

## Backend

Framework: Node.js

## Database

Database: SQLite
Main entities: User, Project
`;

  it("parses basic fields", () => {
    const d = parseDesignSystem(minimal);
    expect(d.project).toBe("TestApp");
    expect(d.features).toContain("Dashboard");
    expect(d.pages.map((p) => p.name)).toContain("Dashboard");
    expect(d.colors.primary).toBe("#7C3AED");
  });

  it("extracts layout and responsive", () => {
    const d = parseDesignSystem(minimal);
    expect(d.layout.maxWidth).toBe("1280px");
    expect(d.layout.pageLayout).toContain("Sidebar");
    expect(d.responsive.desktop).toBeTruthy();
    expect(d.responsive.mobile).toBeTruthy();
  });

  it("produces warnings when details missing", () => {
    const d = parseDesignSystem(minimal);
    expect(Array.isArray(d.warnings)).toBe(true);
  });
});

describe("toDesignSystemJson", () => {
  it("converts to design tokens", () => {
    const md = `# Design

## Colors

### Primary

#7C3AED

### Background

#09090B

### Text

#FAFAFA

## Typography

Font family: Inter

## Layout

Maximum content width: 1280px
Page layout: Sidebar + main content
Sidebar width: 260px

## Border Radius

Cards: 16px
Buttons: 10px

## Spacing

4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px

## Responsive Design

### Desktop

x

### Tablet

x

### Mobile

x
`;
    const d = parseDesignSystem(md);
    const json = toDesignSystemJson(d);
    expect(json.colors.primary).toBe("#7C3AED");
    expect(json.layout.type).toBe("sidebar");
    expect(json.radius.card).toBe(16);
    const css = designSystemToCssTokens(json);
    expect(css).toContain("--color-primary: #7C3AED");
    expect(css).toContain("--radius-card: 16px");
  });
});
describe("section lookup robustness", () => {
  it("matches section headings case-insensitively", () => {
    const md = `# Design

## COLORS

### Primary

#FF0000

### Background

#000000

### Text

#FFFFFF

## typography

Font family: Inter

## LAYOUT

Maximum content width: 1280px
Page layout: Sidebar + main content

## responsive design

### Desktop

x

### Mobile

x
`;
    const d = parseDesignSystem(md);
    expect(d.colors.primary).toBe("#FF0000");
    expect(d.typography.font).toBe("Inter");
    expect(d.layout.maxWidth).toBe("1280px");
    expect(d.responsive.mobile).toBeTruthy();
  });

  it("merges duplicate section headings instead of dropping the earlier body", () => {
    const md = `# Design

## Core Features

- Login

## Core Features

- Dashboard

## Colors

### Primary

#FF0000

### Background

#000000

### Text

#FFFFFF
`;
    const d = parseDesignSystem(md);
    expect(d.features).toContain("Login");
    expect(d.features).toContain("Dashboard");
  });

  it("parses bullet color lines like '- Primary: #FF0000'", () => {
    const md = `# Design

## Colors

- Primary: #FF0000
- Background: #000000
- Text: #FFFFFF
`;
    const d = parseDesignSystem(md);
    expect(d.colors.primary).toBe("#FF0000");
    expect(d.colors.background).toBe("#000000");
    expect(d.colors.text).toBe("#FFFFFF");
  });

  it("parses subsections from merged duplicate color sections", () => {
    const md = `# Design

## Colors

### Primary

#FF0000

## Colors

### Background

#000000

### Text

#FFFFFF
`;
    const d = parseDesignSystem(md);
    expect(d.colors.primary).toBe("#FF0000");
    expect(d.colors.background).toBe("#000000");
    expect(d.colors.text).toBe("#FFFFFF");
  });
});
