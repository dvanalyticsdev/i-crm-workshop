# Codex UI Theme Reference

Use this file when asking Codex to make another project match the UI theme and UI behavior captured in this repository.

## Purpose

This file is the source of truth for the finalized UI style used in this project. When Codex works on another project, give it this file and ask it to restyle that project to match this UI system as closely as possible without breaking the existing product logic.

This is not only a color-theme reference. It is also a UI architecture reference covering layout, navigation, header composition, menus, filters, tables, forms, dialogs, notifications, states, and responsive behavior.

## Source-Of-Truth Files In This Project

If Codex can inspect this repo, these files define the theme and layout patterns:

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

This UI is not flashy, glassy, rounded, or playful. It is a compact professional product interface with a strong orange brand accent, neutral surfaces, clean borders, tight spacing, and dense but readable workflows.

Core visual identity:

- Primary brand color is orange.
- Base surfaces are white in light mode and deep charcoal in dark mode.
- Corners are compact, mostly `4px`.
- Cards rely on subtle borders and soft shadows, not heavy gradients.
- Layout is a left sidebar plus top header plus card-based content area.
- Typography is crisp and modern, using `Plus Jakarta Sans` for UI and `Orbitron` only for a brand wordmark or other limited branded treatment.
- Tables, filters, forms, dashboards, and content panels are the main UI pattern.
- Light mode and dark mode must both exist and must feel like the same product.
- The app should feel structured, trustworthy, and product-oriented, not promotional.

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
- General tone: compact, serious, readable, product-oriented
- Avoid oversized headings and oversized spacing
- Prefer medium weight for labels and section titles rather than extra-bold everywhere
- Use uppercase sparingly and mostly for table headers, badges, helper metadata, and compact overlines

Suggested scale:

- Page title: `28px` to `32px`, weight `700`
- Section title: `18px` to `22px`, weight `600` to `700`
- Card title: `15px` to `18px`, weight `600`
- Body text: `13px` to `15px`
- Helper/meta text: `11px` to `12px`
- Table header text: `11px` to `12px`, uppercase, slight letter-spacing

## Layout Rules

Use these structure rules unless the target app has a strong reason not to:

- App shell should be `left sidebar + right content panel`
- Sidebar width should be about `232px` to `248px`
- Sidebar should be full-height and sticky
- Main content should use card sections with `18px` to `24px` padding
- Top header should be a bordered card, not a transparent bar
- KPI sections, charts, filters, tables, forms, and modals should all use the same token system
- Content should align to a consistent internal grid instead of floating per page
- Dense data pages should prioritize scan speed over decorative spacing

Suggested shell measurements:

- Sidebar width: `240px`
- Topbar min height: `72px` desktop, `64px` tablet/mobile
- Page outer padding: `18px` desktop, `14px` tablet, `12px` mobile
- Gap between major cards: `14px` to `18px`

## Information Architecture Rules

The product should present itself as a tool people use to get real work done. Navigation, grouping, and labels should reflect user tasks rather than internal team structure.

- Organize navigation around jobs-to-be-done, not department names
- Put highest-frequency destinations earlier in the sidebar and header actions
- Keep top-level navigation stable across pages
- Use progressive disclosure for advanced controls, not permanent clutter
- Prefer visible, scannable options over hidden interaction tricks
- Every dense screen should have a clear primary action, current context, and next likely action

## Detailed App Shell Specification

### Sidebar

The sidebar is the primary way to move between product sections.

Required behavior:

- Fixed or sticky on desktop
- Collapsible into an off-canvas panel on smaller screens
- Always shows current section clearly
- Supports icons plus text labels
- Uses compact vertical rhythm

Visual treatment:

- Neutral surface with a thin right border
- Brand block at the top
- Navigation groups stacked with modest spacing
- Active item uses orange text, orange-tinted background, and a left-edge accent
- Hover state is subtle and should not overpower the active state

Sidebar content order:

1. Brand block
2. Primary navigation links
3. Secondary/support links
4. Account/help/logout block if not placed in header menu

Navigation label guidance:

- Keep labels short and task-focused
- Avoid vague items like `Management` if a more specific label such as `Orders`, `Reports`, or `Settings` is more precise
- Do not use more than two words unless required for clarity

### Top Header

The header is not a decorative strip. It is a control surface for context, quick actions, global search, notifications, and account controls.

Visual treatment:

- Card-like surface using the same border and shadow language as the rest of the app
- Horizontal layout with clear left and right zones
- Keep it compact and aligned to page content
- No glass effect, no oversized gradient bar, no floating hero banner treatment

Recommended header zones:

1. Left zone
   - Page title
   - One-line page description or context subtitle
   - Optional breadcrumb on deep pages
2. Middle zone
   - Global search or contextual search when useful
3. Right zone
   - Quick action button if globally relevant
   - Notification bell
   - Theme toggle if not hidden inside the menu
   - User/account menu trigger

Recommended things to put in the header:

- Current page title
- Short supporting context text
- Breadcrumb when the page sits deeper than one navigation level
- Search field when users frequently jump to entities, pages, or records
- Notification bell with unread count
- Environment or role badge only if operationally meaningful
- One primary quick action such as `Create record`, `New project`, or `Import CSV`
- User avatar or compact account entry point

Recommended things not to crowd into the header:

- Large KPI tiles
- Multi-row filter bars unless the page is small and simple
- More than one primary CTA
- Too many unlabeled icons
- Long tab sets and toolbars mixed into the same row unless it is a deliberate secondary row

### Header Composition Details

Desktop header pattern:

- Left align the title block
- Keep subtitle shorter than one line where possible
- Let search sit in the middle only if it is globally valuable
- Group notification, theme, and user controls on the far right
- Maintain even spacing between action items

Tablet header pattern:

- Keep title and essential actions visible
- Search may collapse to an icon or second row
- Breadcrumb may collapse to only the parent item

Mobile header pattern:

- First row should prioritize menu toggle, page title, and the most important global icon
- Secondary information such as subtitle or search can move below the first row
- Avoid more than three right-side icons before overflow

### Header Style Details

- Title block should have stronger typography than the rest of the row
- Subtitle should use muted text and never compete with the title
- Divider lines should be subtle
- Icon buttons should have visible hover/focus states and a predictable hit target of about `40px`
- Badge counts should be compact, high-contrast, and legible at small size

### Breadcrumb Rules

Use breadcrumbs for deeper hierarchy, not for every page.

- Place above the page title or inline with the title block
- Use muted separators
- Mark the current page clearly
- Keep labels short and structural
- Do not use breadcrumbs as a substitute for good sidebar architecture

## Hamburger Menu Specification

The hamburger menu is for responsive navigation or compact global controls. It should not exist on desktop unless there is a real space constraint or it is deliberately being used as an account/actions menu trigger.

Use cases:

- On mobile: open the primary navigation drawer
- In the topbar: open a compact utility menu for account, theme, and session actions

Visual rules:

- Three horizontal lines inside a compact bordered button
- Match card border, compact radius, and neutral fill
- Hover state should tint the surface slightly
- Active/open state can use orange-tinted background and border

Interaction rules:

- Button must expose `aria-haspopup` and `aria-expanded`
- Open on click or keyboard activation, not on hover
- `Enter` and `Space` should open the menu
- `Escape` should close it
- Clicking outside should close it
- Focus should move logically into the menu and return to the trigger when closed

Mobile nav drawer rules:

- Drawer slides from the left
- Backdrop dims the page
- Focus remains inside the open drawer or menu region until closed
- Include a visible close control
- Do not allow the background page to remain interactive while the drawer is open

## Menu And Dropdown Layout Specification

Dropdowns in this design system should feel compact, structured, and purposeful.

### General Dropdown Style

- Surface uses `--notification-surface` or `--surface-overlay`
- Thin border with modest shadow
- Radius remains compact at `4px`
- Internal sections separated with subtle dividers
- Use padding generous enough for clarity but not fluffy

Suggested metrics:

- Min width: `220px`
- Comfortable width for notification/account menus: `260px` to `320px`
- Menu item height: about `36px` to `44px`
- Internal section padding: `8px` to `12px`

### Header Account Menu Layout

Recommended layout:

1. Header block
   - User name
   - Role or account type
   - Optional email or workspace label
2. Utility section
   - Theme toggle
   - Profile/settings link if applicable
   - Help/support link if applicable
3. Session section
   - Log out

Rules:

- Group destructive or session-ending actions separately
- Avoid mixing navigation links and toggles in a visually identical undifferentiated list
- Use full-width buttons or rows for clarity
- Each row should clearly show hover and keyboard focus

### Notification Dropdown Layout

Recommended layout:

1. Sticky or fixed header
   - `Notifications`
   - Optional unread count
   - Optional `Mark all as read`
2. Scrollable list body
   - Each item shows title, time, and one short message preview
3. Footer action
   - `View all`

Rules:

- Unread items should be visually distinct but subtle
- Time stamps should use muted text
- Empty state should be explicit, not blank
- Long bodies should truncate cleanly
- If the list is scrollable, keep header and footer visually stable

### Overflow And Action Menus

Use action menus for contextual commands on rows, cards, or modules.

- Order actions from most common to least common
- Destructive actions go last
- Do not hide the only primary action inside overflow
- Row menus should open aligned to the trigger and avoid covering the row label if possible

## Component Rules

### Cards

- White or charcoal surface depending on theme
- Thin neutral border
- Soft shadow
- Radius `4px`
- Internal padding usually `14px` to `24px`
- Header, body, and footer areas should align cleanly
- Cards should support dense product content without feeling cramped

Card layout guidance:

- Header may contain title, helper text, and a compact action area
- Body carries table, form, KPI, or content module
- Footer is optional and typically used for pagination, summary totals, or secondary actions

### Buttons

- Primary button is solid orange with white text
- Secondary and ghost buttons use surface background with border
- Danger button uses red text and red hover state
- Button shapes are compact, not pill-heavy
- Use one clear primary button per area
- Icon-only buttons need accessible labels and visible hover/focus state

Button sizing guidance:

- Default height: `36px` to `40px`
- Compact toolbar buttons: `32px` to `36px`
- Avoid oversized CTA buttons in dense product workflows

### Inputs

- White or dark background depending on theme
- Thin neutral border
- Radius `4px`
- Orange focus ring
- Text centered in some filter contexts, standard left alignment elsewhere
- Labels should remain visible and should not rely on placeholder text as the only cue
- Validation messaging should appear close to the field and in plain language

Field layout guidance:

- Label above input for dense product forms
- Helper text below only when needed
- Required indicator should be subtle but clear
- Related fields may be arranged in responsive rows

### Filters And Search

Filters are a first-class pattern in this UI system and should be designed as a compact control bar above data views.

- Place filters above the table inside the same card or directly adjacent card
- Order filters from highest-frequency to lowest-frequency
- Keep default states obvious
- Use text search first, then structured filters, then advanced filters
- Provide a visible reset or clear-filters action
- Show active filter state when results are narrowed

Global search guidance:

- Use in header only if people frequently jump across entities or pages
- Otherwise use page-level search tied to the current dataset

### Sidebar

- Neutral panel with thin right border
- Active item uses orange text, orange-tinted background, and left border accent
- Hover state is subtle muted-surface fill
- Labels should left-align for scan speed

### Tables

- Full-width with clean horizontal separators
- Header text uppercase, muted, small
- Cells centered in this design system unless the target use case clearly needs left-aligned data
- Row hover should stay subtle
- Table titles and result counts should be visible above the table
- Use a caption or clearly associated title for accessibility and context

Dense data table guidance:

- Keep column labels short
- Align numeric values consistently
- Truncate overly long content with hover or drill-down access where needed
- Use sortable columns only where sorting is meaningful
- Persist sort/filter state if the workflow benefits from it
- On smaller screens, prefer horizontal scroll over broken stacked pseudo-tables for dense datasets

Table row actions:

- Keep quick actions visible when common
- Use overflow menus for secondary actions
- Selection checkboxes should have a clear bulk-action pattern

### Pagination

- Pagination belongs at the bottom of long tables or search result sets
- Pair it with result count or page summary
- Current page should be clearly marked
- Do not create large gaps between pagination items
- If the dataset is relevance-ranked and effectively unbounded, a next/previous pattern may be better than a high page count

### Pills And Status

- Success uses green
- Danger uses red/orange-red
- Info/accent states use orange tint
- Keep pills compact and crisp
- Status labels should use plain words such as `Open`, `Pending`, `Done`, `Failed`, `Active`, `Archived`

### Tabs

Tabs are appropriate when multiple peer views share one page context.

- Keep the active tab obvious through color, border, or underline
- Avoid large animation-heavy transitions
- Use tabs only when content areas are closely related
- If tab content is slow to load, prefer manual activation on click instead of instant activation on arrow focus

### Empty States

Empty states should be calm, explicit, and action-oriented.

- State what is empty
- Explain why when it is useful
- Offer the next best action
- Avoid overly playful illustration-heavy empty states

Examples:

- `No results match the current filters. Clear filters or widen your search.`
- `Nothing has been created yet. Create the first item to get started.`

### Loading States

- Use skeletons or subdued placeholders for cards and tables when load time is noticeable
- Avoid large spinners blocking the entire page unless the entire view truly cannot render
- Keep layout dimensions stable while loading to reduce jumpiness

### Error States

- Use concise plain-language messaging
- Explain whether the issue is retryable
- Show a retry action when appropriate
- Differentiate inline validation errors, section-level failures, and global system failures

### Toasts And Alerts

- Toasts are for brief non-blocking confirmations or updates
- Alerts are for important persistent messages that must stay visible
- Avoid auto-dismissing critical information too quickly
- Frequent toasts should not overwhelm the operator
- Toasts should not steal focus

### Notifications

- Notification bell lives in the header
- Badge count should be compact and capped visually if needed
- Notification text should be short and useful
- Messages should help a user decide whether to click now, later, or ignore

### Modals

- Use the same card surface and border language
- Overlay is a dark translucent backdrop
- Modal content should not look detached from the rest of the system
- Title, supporting text, body, and footer actions should have clear separation
- Always provide a visible close mechanism
- Avoid using modals for very large multi-step workflows if a full page or drawer is clearer

Modal sizing guidance:

- Confirmation modal: `360px` to `480px`
- Standard form modal: `520px` to `720px`
- Large record-detail modal only if the workflow clearly benefits

### Drawers

Use side drawers when the task needs more space than a modal but should preserve page context.

- Good for record preview, edit forms, filters, or logs
- Keep the same token language as cards and modals
- Provide a clear close action and title

## Responsive Behavior Rules

This UI should remain practical on desktop, tablet, and mobile.

### Desktop

- Sidebar visible
- Header in one row where possible
- Filters can sit in one or two rows above a table
- Table remains the dominant data presentation

### Tablet

- Sidebar may collapse
- Header can become two rows
- Some secondary actions move into menus
- Tables can scroll horizontally inside a bounded container

### Mobile

- Sidebar becomes an off-canvas drawer triggered by hamburger
- Header keeps only critical controls visible
- Search and filters can move into stacked blocks or a filter drawer
- Preserve data readability; do not shrink text excessively
- Use horizontal table scroll for dense data instead of fragmented cardified rows unless the dataset is very simple

## Accessibility And Interaction Rules

These rules should be preserved even when adapting the theme to a different stack.

- Include a skip link before navigation for keyboard and screen-reader users
- Use semantic navigation landmarks
- If there is more than one `nav`, label them clearly
- Use click or keyboard activation for dropdowns, not hover-only behavior
- Visible focus styles are required
- Menus and dialogs must manage focus correctly
- Background content must become inert when a modal dialog is open
- Current navigation item should be programmatically identifiable
- Notification, alert, and status color cannot be the only cue
- Icon-only buttons must have accessible names

Required menu semantics:

- Trigger is a real `button`
- Use `aria-haspopup`
- Use `aria-expanded`
- Optional `aria-controls` when useful

Required dialog semantics:

- Dialog has an accessible name
- Focus moves into the dialog on open
- `Escape` closes the dialog unless the workflow has a strong reason not to
- Focus returns logically after close

Required breadcrumb semantics:

- Breadcrumb is inside a navigation landmark
- Current page uses `aria-current="page"`

Required tab semantics:

- `tablist`, `tab`, and `tabpanel` relationships must be valid
- Active tab state must be programmatically expressed

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
- The only strong gradient usage should be limited branded treatment such as a logo or wordmark
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
- modal styling
- dropdown/menu styling
- empty/loading/error states
- dark mode behavior

## Migration Strategy For Another Project

Ask Codex to do the following:

1. Inspect the target app structure and find its shared layout, theme, navigation, and component entry points.
2. Introduce a shared token file or CSS variable layer matching this theme.
3. Restyle shared primitives first: page shell, sidebar, topbar, cards, typography, buttons, inputs, tables, modals, menus, pills, alerts, empty states, and pagination.
4. Add light/dark theme persistence with the same behavior as this project.
5. Apply the theme consistently across all major screens instead of only the landing page.
6. Preserve or improve accessibility semantics while matching the visual system.
7. Keep functionality unchanged while making the UI feel like the same product family as this design system.

## Ready-To-Paste Prompt For Codex

Copy this prompt into another project along with this file:

```text
Use the attached CODEX_UI_THEME_REFERENCE.md as the source of truth and restyle this project so its UI matches that design system as closely as possible.

Requirements:
- Keep all business logic, APIs, routing, and functionality unchanged.
- Rebuild the visual system using the same design language: orange primary accent, compact 4px radii, neutral bordered cards, professional product UI styling, consistent sidebar/topbar shell, and matching light/dark mode behavior.
- Match not just colors, but also layout behavior, navigation structure, header composition, menu/dropdown patterns, form density, data-table treatment, empty states, notifications, and modal/dialog behavior.
- Use CSS variables or the project's equivalent token system so the theme is centralized.
- Apply the theme across shared layout, forms, tables, cards, filters, modals, badges, menus, notifications, pagination, and buttons.
- Do not introduce a new aesthetic. Do not use glassmorphism, purple gradients, oversized rounded corners, or playful startup-style UI.
- If the framework is React, Next.js, Vue, Angular, plain HTML, or another stack, adapt the implementation to that stack while preserving this same visual identity.
- Before editing, inspect the project and identify the best shared entry points for global theme tokens and reusable UI primitives.
- After implementing, verify the major pages for consistency and list any places that could not be fully matched.
```

## Acceptance Checklist

The work is correct only if:

- another project immediately feels like the same company design language
- orange is the dominant action color
- cards, tables, filters, topbars, and menus all look visually related
- dark mode feels intentionally designed, not auto-inverted
- corners stay compact
- borders and shadows stay subtle
- the header contains clear context and useful global actions instead of decorative clutter
- the hamburger and dropdown behavior feel deliberate, not tacked on
- tables remain practical and readable on smaller screens
- empty, loading, error, and notification states match the same design language
- the UI remains practical and product-focused
- the new project does not drift into a different aesthetic

## Research Basis

The guidance above is informed by current public design-system and accessibility references, then adapted to this repository's visual identity and dense product use case.

Primary references:

- Material Design 3 app bars overview: `https://m3.material.io/components/app-bars/overview`
- Material Design 3 navigation drawer overview: `https://m3.material.io/components/navigation-drawer/overview`
- Material Design 3 menus overview: `https://m3.material.io/components/menus/overview`
- W3C APG menu button pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/`
- W3C APG dialog modal pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`
- W3C APG breadcrumb pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/`
- W3C APG tabs pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/tabs/`
- W3C APG alert pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/alert/`
- W3C APG combobox pattern: `https://www.w3.org/WAI/ARIA/apg/patterns/combobox/`
- U.S. Web Design System header: `https://designsystem.digital.gov/components/header/`
- U.S. Web Design System table: `https://designsystem.digital.gov/components/table/`
- U.S. Web Design System modal: `https://designsystem.digital.gov/components/modal/`
- U.S. Web Design System pagination: `https://designsystem.digital.gov/components/pagination/`

## Recommended Usage

Best workflow for future projects:

1. Add this file to the repo root, or attach it in the Codex prompt.
2. Tell Codex to inspect the current project and apply this exact design system.
3. Ask Codex to change shared primitives first, then page-specific components.
4. Ask Codex to preserve or improve accessibility behavior while matching the theme.
5. Ask Codex to verify every major screen for theme consistency before finishing.
