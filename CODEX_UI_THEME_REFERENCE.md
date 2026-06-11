# Codex UI Theme Reference

Use this file when asking Codex to make another project match the UI theme of this CRM app.

## Purpose

This file is the source of truth for the finalized UI style used in this project. When Codex works on another project, give it this file and ask it to restyle that project to match this theme as closely as possible without breaking the existing product logic.

## Source-Of-Truth Files In This Project

If Codex can inspect this repo, these files define the theme:

- `styles.css`
- `theme.js`
- `theme-bootstrap.js`
- `layouts.js`
- `index.html`
- `dashboard.html`
- `pre-workshop.html`
- `post-workshop.html`
- `monitoring.html`
- `lead-control.html`
- `counselor-management.html`
- `task-tracker.html`
- `lost-leads.html`
- `meta-integration.html`

## Theme Identity

This UI is not flashy, glassy, rounded, or playful. It is a compact professional admin dashboard theme with a strong orange brand accent, neutral surfaces, clean borders, and tight spacing.

Core visual identity:

- Primary brand color is orange.
- Base surfaces are white in light mode and deep charcoal in dark mode.
- Corners are compact, mostly `4px`.
- Cards rely on subtle borders and soft shadows, not heavy gradients.
- Layout is a left sidebar plus top header plus card-based content area.
- Typography is crisp and modern, using `Plus Jakarta Sans` for UI and `Orbitron` only for the i-CRM wordmark.
- Tables, filters, and admin panels are the main UI pattern.
- Light mode and dark mode must both exist and must feel like the same product.

## Exact Theme Tokens

### Light Mode

```css
:root {
  --bg: #ffffff;
  --page-gradient: #ffffff;
  --surface: #ffffff;
  --surface-muted: #fafafa;
  --surface-elevated: #ffffff;
  --surface-overlay: #ffffff;
  --border: #e8e8e8;
  --border-strong: #dfdfdf;
  --text: #000000;
  --text-muted: #000000;
  --heading: #000000;
  --primary: #e05322;
  --primary-soft: rgba(224, 83, 34, 0.08);
  --primary-gradient: #e05322;
  --accent: #e05322;
  --accent-soft: rgba(224, 83, 34, 0.08);
  --success: #4caf50;
  --success-soft: rgba(76, 175, 80, 0.08);
  --danger: #df514c;
  --danger-soft: rgba(223, 81, 76, 0.08);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.09);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
  --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.10), 0 4px 8px rgba(0, 0, 0, 0.05);
  --chart-1: #e05322;
  --chart-2: #3b82f6;
  --chart-3: #4caf50;
  --chart-4: #9b9b9b;
  --chart-5: #df514c;
  --chart-fill: rgba(224, 83, 34, 0.08);
  --chart-grid: rgba(232, 232, 232, 0.8);
  --toast-bg: #222222;
  --toast-border: #333333;
  --notification-surface: #ffffff;
  --notification-border: #e8e8e8;
  --notification-divider: #f0f0f0;
  --notification-hover: rgba(224, 83, 34, 0.04);
  --notification-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  --overlay: rgba(0, 0, 0, 0.4);
  --input-bg: #ffffff;
  --input-border: #e8e8e8;
  --input-shadow: 0 0 0 2px rgba(224, 83, 34, 0.15);
  --row-hover: #fafafa;
  --toggle-bg: #ffffff;
  --toggle-track: #e8e8e8;
  --toggle-thumb: #9b9b9b;
  --radius-sm: 4px;
  --radius-md: 4px;
  --radius-lg: 4px;
  --space-1: 6px;
  --space-2: 10px;
  --space-3: 14px;
  --space-4: 18px;
  --space-5: 24px;
  --space-6: 32px;
  --ease: 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-slow: 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
```

### Dark Mode

```css
html[data-theme="dark"] {
  --bg: #161922;
  --page-gradient: #161922;
  --surface: #191c24;
  --surface-muted: #212431;
  --surface-elevated: #1e222b;
  --surface-overlay: #1e222b;
  --border: #2d323f;
  --border-strong: #383e4d;
  --text: #cbd5e1;
  --text-muted: #8e9db0;
  --heading: #ffffff;
  --primary: #f05a28;
  --primary-soft: rgba(240, 90, 40, 0.1);
  --primary-gradient: #f05a28;
  --accent: #f05a28;
  --accent-soft: rgba(240, 90, 40, 0.1);
  --success: #00b852;
  --success-soft: rgba(0, 184, 82, 0.1);
  --danger: #ff5722;
  --danger-soft: rgba(255, 87, 34, 0.1);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.6);
  --chart-1: #f05a28;
  --chart-2: #5cc8ff;
  --chart-3: #00b852;
  --chart-4: #8e9db0;
  --chart-5: #ff5722;
  --chart-fill: rgba(240, 90, 40, 0.12);
  --chart-grid: rgba(45, 50, 63, 0.5);
  --toast-bg: #1e222b;
  --toast-border: #2d323f;
  --notification-surface: #191c24;
  --notification-border: #2d323f;
  --notification-divider: #282d39;
  --notification-hover: rgba(240, 90, 40, 0.05);
  --notification-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  --overlay: rgba(0, 0, 0, 0.6);
  --input-bg: #161922;
  --input-border: #2d323f;
  --input-shadow: 0 0 0 2px rgba(240, 90, 40, 0.18);
  --row-hover: #212431;
  --toggle-bg: #191c24;
  --toggle-track: #2d323f;
  --toggle-thumb: #8e9db0;
}
```

## Typography

- Primary UI font: `Plus Jakarta Sans`
- Brand/logo font only: `Orbitron`
- General tone: compact, serious, readable, admin-oriented
- Avoid oversized headings and oversized spacing

## Layout Rules

Use these structure rules unless the target app has a strong reason not to:

- App shell should be `left sidebar + right content panel`
- Sidebar width should be about `240px`
- Sidebar should be full-height and sticky
- Main content should use card sections with `18px` to `24px` padding
- Top header should be a bordered card, not a transparent bar
- KPI sections, charts, filters, tables, forms, and modals should all use the same token system

## Component Rules

### Cards

- White or charcoal surface depending on theme
- Thin neutral border
- Soft shadow
- Radius `4px`
- Internal padding usually `14px` to `24px`

### Buttons

- Primary button is solid orange with white text
- Secondary and ghost buttons use surface background with border
- Danger button uses red text and red hover state
- Button shapes are compact, not pill-heavy

### Inputs

- White or dark background depending on theme
- Thin neutral border
- Radius `4px`
- Orange focus ring
- Text centered in some filter contexts, standard left alignment elsewhere

### Sidebar

- Neutral panel with thin right border
- Active item uses orange text, orange-tinted background, and left border accent
- Hover state is subtle muted-surface fill

### Tables

- Full-width with clean horizontal separators
- Header text uppercase, muted, small
- Cells centered in this design system unless the target use case clearly needs left-aligned data
- Row hover should stay subtle

### Pills And Status

- Success uses green
- Danger uses red/orange-red
- Info/accent states use orange tint
- Keep pills compact and crisp

### Modals

- Use the same card surface and border language
- Overlay is a dark translucent backdrop
- Modal content should not look detached from the rest of the system

## Theme Behavior

The theme system must support:

- persisted light/dark mode via local storage
- early theme bootstrapping before the page paints
- one shared toggle pattern across pages
- CSS custom properties as the single source of visual truth

Implementation pattern:

- `theme-bootstrap.js` sets initial `data-theme`
- `theme.js` handles toggle logic and storage
- components read colors from CSS variables, not hardcoded values

## Brand Rules

- Main accent is orange, not blue, purple, teal, or gradient-heavy
- The only strong gradient usage should be the `i-CRM` wordmark treatment
- General UI surfaces should stay flat and professional
- Do not introduce glassmorphism, neon glow, oversized radii, floating blobs, or marketing-site styling

## What Codex Should Preserve In Other Projects

When adapting another project, Codex should preserve:

- business logic
- routing
- backend integrations
- existing data flow
- domain-specific screens

Codex should change:

- design tokens
- component skin
- page shell
- spacing rhythm
- buttons
- forms
- tables
- cards
- modal styling
- dark mode behavior

## Migration Strategy For Another Project

Ask Codex to do the following:

1. Inspect the target app structure and find its shared layout, theme, and component entry points.
2. Introduce a shared token file or CSS variable layer matching this theme.
3. Restyle shared primitives first: page shell, cards, typography, buttons, inputs, tables, modals, pills.
4. Add light/dark theme persistence with the same behavior as this project.
5. Apply the theme consistently across all major screens instead of only the landing page.
6. Keep functionality unchanged while making the UI feel like the same product family as this CRM.

## Ready-To-Paste Prompt For Codex

Copy this prompt into another project along with this file:

```text
Use the attached CODEX_UI_THEME_REFERENCE.md as the source of truth and restyle this project so its UI matches that CRM theme as closely as possible.

Requirements:
- Keep all business logic, APIs, routing, and functionality unchanged.
- Rebuild the visual system using the same design language: orange primary accent, compact 4px radii, neutral bordered cards, professional admin-dashboard styling, consistent sidebar/topbar shell, and matching light/dark mode behavior.
- Use CSS variables or the project’s equivalent token system so the theme is centralized.
- Apply the theme across shared layout, forms, tables, cards, filters, modals, badges, and buttons.
- Do not introduce a new aesthetic. Do not use glassmorphism, purple gradients, oversized rounded corners, or playful startup-style UI.
- If the framework is React, Next.js, Vue, Angular, plain HTML, or another stack, adapt the implementation to that stack while preserving this same visual identity.
- Before editing, inspect the project and identify the best shared entry points for global theme tokens and reusable UI primitives.
- After implementing, verify the major pages for consistency and list any places that could not be fully matched.
```

## Acceptance Checklist

The work is correct only if:

- another project immediately feels like the same company design language
- orange is the dominant action color
- cards, tables, filters, and topbars all look visually related
- dark mode feels intentionally designed, not auto-inverted
- corners stay compact
- borders and shadows stay subtle
- the UI remains practical and admin-focused
- the new project does not drift into a different aesthetic

## Recommended Usage

Best workflow for future projects:

1. Add this file to the repo root, or attach it in the Codex prompt.
2. Tell Codex to inspect the current project and apply this exact design system.
3. Ask Codex to change shared primitives first, then page-specific components.
4. Ask Codex to verify every major screen for theme consistency before finishing.
