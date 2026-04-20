# Design System

## Typography Scale
[TODO] Lock font sizes, weights, and line heights.

## Color Variables
Use existing semantic tokens only for status communication in the social account pool. Success states use existing success foreground and border tokens, warning or incomplete states use existing muted foreground plus border tokens, and error states use existing danger tokens. Do not introduce new colors or gradients for this feature.
## Color Variables
Use existing semantic tokens only for status communication in the social account pool. Success states use existing success foreground/border tokens, warning or incomplete states use existing muted foreground plus border tokens, and error states use existing danger tokens. Do not introduce new colors or gradients for this feature.
## Spacing System
Preserve the current panel rhythm and control spacing already used in the social account pool. Status copy should fit within the existing card layout with no new spacing scale. Prefer tightening copy before changing layout spacing.
## Spacing System
Preserve the current panel rhythm and control spacing already used in the social account pool. Status copy should fit within the existing card layout with no new spacing scale. Prefer tightening copy before changing layout spacing.
## Border & Shadow Logic
Keep the current card, modal, and inline alert border treatment. This fix should clarify state through copy, icon choice, and deterministic row selection rather than adding stronger shadows or new elevation layers.
## Border & Shadow Logic
Keep the current card, modal, and inline alert border treatment. This fix should clarify state through copy, icon choice, and deterministic row selection rather than adding stronger shadows or new elevation layers.
## Component Reuse Rules
Reuse the existing account row, Button, Input, Label, Textarea, Select, and inline status icon patterns already present in the surface. Do not add new status badge components for this fix unless the existing row cannot express the state clearly.
## Component Reuse Rules
Reuse the existing account row, Button, Input, Label, Textarea, Select, and inline status icon patterns already present in the surface. Do not add new status badge components for this fix unless the existing row cannot express the state clearly.
## Interaction States
When an OAuth return is processing, show a loading message tied to the affected account and avoid presenting conflicting idle actions. Once processing completes, the selected row should reflect the final state immediately. Keep existing hover, selected, focus, and disabled patterns for rows and buttons.
## Interaction States
When an OAuth return is processing, show a loading message tied to the affected account and avoid presenting conflicting idle actions. Once processing completes, the selected row should reflect the final state immediately. Keep existing hover, selected, focus, and disabled patterns for rows and buttons.
## Accessibility Defaults
Status text must be understandable without color alone. Pair icons with explicit labels such as Connected, Needs sign-in, Syncing, or No platform selected. Preserve button labels that describe the next action in plain language.
## Accessibility Defaults
Status text must be understandable without color alone. Pair icons with explicit labels such as Connected, Needs sign-in, Syncing, or No platform selected. Preserve button labels that describe the next action in plain language.
