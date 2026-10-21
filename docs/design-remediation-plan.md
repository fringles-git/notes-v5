# Design-system remediation plan

This document is the safe, incremental remediation plan for the Notes design system. It is intentionally scoped to low-risk work and does not change the app’s product behavior unless a step explicitly states so.

## Guardrails

- Keep the current app architecture intact.
- Prefer token-only changes before component-level changes.
- Do not add dependencies, fonts, or emoji.
- Preserve the current French UX direction and the single-accent rule unless a product decision justifies an exception.
- Validate accessibility, reduced-motion, and contrast after each PR.

## Phase 1: token and semantic integrity

### PR 1 — Token audit and hard-code cleanup

Goal:
- Make the token layer the single source of truth for colour, space, radius, size, shadow, and type.

Scope:
- Audit every CSS declaration in `src/notes/styles/app.css` and related component files.
- Move remaining raw values into `src/notes/styles/tokens.css` where they are not already tokens.
- Leave component logic alone.

Acceptance criteria:
- No raw `#hex`, `rgb(...)`, `white`, `black`, or literal radius/spacing values remain in component CSS except where they are defined in the token foundation.
- `tokens.css` contains all design primitives and all component families read from the tokens.
- No visual regression in a quick smoke test across light/dark and glass/paper.

Risk:
- Low
- Most changes are mechanical and do not affect behaviour.

### PR 2 — Typography normalization

Goal:
- Enforce one consistent text system with no ad hoc display overrides.

Scope:
- Review `--font`, `--font-display`, `--text-*`, `--weight-*`, and tracking tokens.
- Remove font-family drift or duplicate load paths unless a look explicitly requires them.
- Keep the current look strategy but reduce accidental mismatches.

Acceptance criteria:
- A single tokenized type scale is used everywhere.
- All headings/body labels reference the token layer.
- No component sets a custom font family or raw pixel size that bypasses tokens.

Risk:
- Low

### PR 3 — Semantic colour system enforcement

Goal:
- Enforce a strict meaning map:
  - amber = create / pinned
  - blue = selection / focus
  - red = delete / recording
  - green = done / on
  - folder colours = organisation only

Scope:
- Audit `src/notes/styles/tokens.css` and `app.css` for semantic drift.
- Replace component-specific raw colors with semantic tokens.
- Validate contrast and the current tinted states.

Acceptance criteria:
- Every state in the app is represented through semantic tokens rather than ad hoc fill values.
- Both light and dark modes remain WCAG AA compliant for text and controls.
- No folder colour leaks into action or status semantics.

Risk:
- Low to medium
- Visual polish may need minor tuning after checks.

## Phase 2: interaction fidelity

### PR 4 — Dock and create interaction tightening

Goal:
- Preserve the thumb-first dock while improving clarity and discoverability.

Scope:
- Review the active tab logic and the floating `+` flow.
- Keep the “one accent action per screen” rule.
- Add first-use affordances for press-and-slide and pull-to-search where they are currently hidden.

Acceptance criteria:
- The dock remains one-handed and thumb-first.
- The floating action has an unambiguous primary role.
- Hidden gestures have discoverability hints without undermining the minimal UI.

Risk:
- Medium
- Interaction work is more visible to users than token-only changes.

### PR 5 — Gesture safety and accessibility pass

Goal:
- Make gestures safe, discoverable, and accessible without relying on hidden actions.

Scope:
- Validate swipe, long-press, pull-to-search, and create gestures.
- Ensure touch targets remain at least 44px.
- Validate reduced motion and forced-colours support.

Acceptance criteria:
- Critical actions remain accessible via visible controls, not drag-only gestures.
- No important task depends on a hidden gesture alone.
- Focus rings remain visible and consistent in both themes.

Risk:
- Medium

## Phase 3: product-quality polish

### PR 6 — Copy localization and product-language enforcement

Goal:
- Align all visible copy with the French UI rules in the design brief.

Scope:
- Audit UI strings for English leftovers, sentence-case drift, and inconsistent action wording.
- Keep plain-text note content and light markup only.

Acceptance criteria:
- All app UI strings are in French.
- Actions use infinitive verbs in sentence case.
- No emoji appear in the UI.
- Copy rules are applied consistently to empty states, modals, and toasts.

Risk:
- Low

### PR 7 — Sheet and popover deduplication

Goal:
- Keep one consistent sheet/popover system.

Scope:
- Consolidate overlapping patterns for panels, sheets, and popovers.
- Reduce ad hoc positioning and motion differences.

Acceptance criteria:
- One shared base pattern for layers, sheets, and menus.
- Similar spacing, radius, and motion rules are reused consistently.
- No feature-specific stack of layers diverges from the main system.

Risk:
- Low to medium

## Recommended order of execution

1. PR 1
2. PR 2
3. PR 3
4. PR 4
5. PR 5
6. PR 6
7. PR 7

This order keeps the work low-risk and ensures the app remains visually coherent before interaction polish begins.

## Success checklist for each PR

- Design tokens remain the source of truth.
- Contrast is checked in light and dark themes.
- Reduced motion remains respected.
- No new dependency is introduced.
- The app remains functionally stable after the change.
- The UI remains consistent with the product brief.

## Notes

This plan intentionally starts with the safest work: token integrity and design-system coherence. Once those are stable, interaction and UX improvements become far less risky and much more measurable.
