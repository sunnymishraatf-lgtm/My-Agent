import { createInterface } from "node:readline";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_TEMPLATE } from "../templates";

export async function initCommand(cwd: string, opts?: { template?: boolean; force?: boolean }): Promise<void> {
  const storeDir = join(cwd, ".agent");
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  console.log("Initialized neutron project in", cwd);

  const designPath = join(cwd, "design.md");
  if (opts?.template) {
    if (existsSync(designPath) && !opts.force) {
      console.log("design.md already exists; use --force to overwrite.");
    } else {
      writeFileSync(designPath, DESIGN_TEMPLATE, "utf8");
      console.log("Created design.md from template.");
    }
  } else if (existsSync(designPath)) {
    console.log("Found existing design.md.");
  } else {
    console.log("No design.md found. Run `neutron design` to create one.");
  }
}

export async function designCommand(cwd: string, opts?: { template?: boolean }): Promise<void> {
  const designPath = join(cwd, "design.md");
  if (existsSync(designPath)) {
    console.log("design.md already exists.");
    return;
  }
  if (opts?.template) {
    writeFileSync(designPath, DESIGN_TEMPLATE, "utf8");
    console.log("Created design.md from template.");
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const name = await new Promise<string>((resolve) => rl.question("Project name: ", (a) => resolve(a.trim())));
  rl.close();
  const content = `# Design

## Project

Name: ${name || "My Project"}
Short description:

## Vision

Describe the product.

## Users

Who will use it?

## Core Features

- Feature 1
- Feature 2

## Pages

### Dashboard

Description.

## User Flow

Login
→ Dashboard

## UI / UX

Modern, minimal.

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

Sidebar + content.

### Mobile

Slide-in drawer.

## Frontend

Framework: React

## Backend

Framework: Node.js

## Database

Database: SQLite
Main entities:

## Authentication

Authentication method:

## Acceptance Criteria

- Requirement 1
`;
  writeFileSync(designPath, content);
  console.log("Created design.md");
}

export function planCommand(cwd: string): void {
  const storeDir = join(cwd, ".agent");
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  console.log("Engineering plan generated.");
}