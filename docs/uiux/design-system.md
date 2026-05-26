# Design System

## Typography Scale
Use the existing loaded fonts: Bricolage Grotesque for sparse brand/display moments, Instrument Sans for interface copy, and IBM Plex Mono only for tool ids, timestamps, and technical evidence. Founder-facing pages should use restrained type: compact top bars, readable chat prose, small status labels, and no oversized dashboard hero headings inside the app.
## Color Variables
Use existing semantic tokens only: background, surface, surface-muted, surface-hover, sidebar, foreground, muted-foreground, border, border-strong, accent, success, warning, and danger. The product should read as warm neutral and focused, not purple/blue AI SaaS. Color communicates state and action priority, not decoration.
## Spacing System
Default app rhythm is dense but calm: 14px top bars, 8-12px control gaps, 16px panel padding, and 52rem chat/evidence width unless a drilldown needs tables. Avoid stacking page intro, stat ledger, and section panels above the user's main task. Prefer one primary work column with secondary detail hidden in Details or drilldowns.
## Border & Shadow Logic
Use borders and flat surfaces as the default. Shadows are reserved for overlays, floating composers, and popovers. Avoid nested cards and decorative elevation. Chat assistant text should be unboxed prose; user prompts can use one muted rounded bubble. Evidence/activity rows use thin borders and disclosure, not heavy cards.
## Component Reuse Rules
Prefer shared primitives before page-specific chrome: AppShell navigation, BrandSwitcher, OperatorPanel, Button, Badge, Input, Textarea, Select, PageIntro, SectionPanel, EmptyState, and the operator-workspace primitives. New pages should use operator workspace primitives for status strips, drilldown links, evidence/activity rows, and simple page headers instead of inventing cards or local nav.
## Interaction States
Every important state must be written in plain English: working, needs attention, blocked, waiting, completed, failed. Loading should preserve the surrounding shape. Errors should say what failed and what the agent/user can do next. Advanced/debug data should be accessible through disclosure, not shown as default body copy.
## Accessibility Defaults
Use visible text labels for primary controls, not icon-only actions. Status must not depend on color alone. Interactive rows need clear hover/focus states. Details disclosures must have meaningful summary text. Keep keyboard focus visible with the existing ring token. Avoid truncating critical brand, blocker, or action text without another way to read it.
