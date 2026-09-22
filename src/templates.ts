export const DESIGN_TEMPLATE = `# Design

## Project

Name: My Project
Short description: A short, one-sentence description of the product.

## Vision

Describe the product in a paragraph. What problem does it solve? Why does it exist?

## Users

Who will use it? Describe the target audience.

## Core Features

- Feature 1
- Feature 2
- Feature 3

## Pages

### Dashboard

Description of the dashboard page.

### Login

Description of the login page.

### Sign Up

Description of the sign-up page.

## User Flow

Login
→ Dashboard
→ Create Project
→ View Project
→ Logout

## UI / UX

Describe the visual style, mood, and feel. Examples: Modern, Minimal, Premium, Dark, Clean.

## Design Direction

Modern / Minimal / Premium / Enterprise / Dark / Playful

## Theme

Dark

Light + Dark
Allow theme switching: Yes

## Colors

### Primary

#7C3AED

### Secondary

#6366F1

### Background

#09090B

### Surface

#18181B

### Card

#1F1F23

### Text

#FAFAFA

### Muted Text

#A1A1AA

### Border

#27272A

### Success

#22C55E

### Warning

#F59E0B

### Error

#EF4444

## Gradients

- Primary to Secondary

## Typography

Font family: Inter
Heading font: Inter
Body font: Inter
Heading weights: 700 / 800
Body weight: 400 / 500

## Layout

Maximum content width: 1280px
Page layout: Sidebar + main content
Sidebar width: 260px
Header height: 64px
Content padding: 24px

## Grid

Desktop: 12 columns
Tablet: 8 columns
Mobile: 4 columns

## Spacing

4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px

## Border Radius

Buttons: 10px
Cards: 16px
Inputs: 10px

## Shadows

- sm: 0 1px 2px rgba(0,0,0,0.05)
- md: 0 4px 6px rgba(0,0,0,0.07)
- lg: 0 10px 15px rgba(0,0,0,0.10)

## Components

### Buttons

Rounded, filled with the primary color. Hover: slightly brighter.

### Cards

Surface background, subtle border, radius 16px.

### Inputs

Filled surface background, thin border, radius 10px.

### Navigation

Sidebar with nav links, active link highlighted with primary color.

### Modals

Centered overlay with dimmed backdrop, radius 16px.

## Responsive Design

### Desktop

Sidebar + main content, 12-column grid.

### Tablet

Sidebar collapses to 48px icon rail.

### Mobile

Sidebar becomes a slide-in drawer, 4-column grid.

## Animations

- Fade in
- Slide down for modals

Animation speed: 150–300ms
Animation style: ease-out

## Icons

Icon library: Lucide

## Images

Use clean, high-quality images with consistent aspect ratios.

## Accessibility

Minimum contrast: WCAG AA
Keyboard navigation: Required
Focus states: Required

## Frontend

Framework: React
Component library: Tailwind + shadcn/ui

## Backend

Framework: Node.js / Express
API style: REST

## Database

Database: SQLite
Main entities: Project, User, Task

## Authentication

Authentication method: JWT email/password

## Security

Security requirements: HTTPS, secure cookies, input validation, rate limiting, no secrets in frontend.

## Integrations

External APIs: None

## Acceptance Criteria

- Users can create an account and log in.
- Users can create, view, edit, and delete projects.
- Dashboard displays projects in a grid.
- Mobile layout is responsive and matches the design.
- Critical user flows are tested.

## Do Not

- Do not use random colors.
- Do not use gradients outside the approved gradients.
- Do not change the sidebar width.
- Do not introduce another font.
- Do not use excessive animations.
- Do not create unnecessary cards.
`;