# CalMobile UI design contract

## 0. Direction

CalMobile uses a calm, professional exhibition-planning surface: deep indigo for primary actions, warm amber for attention and exhibition energy, and cool neutral surfaces that keep dense calendar and registration content readable. The design should feel dependable and focused rather than decorative.

## 1. Tokens

Use existing Android resources as the source of truth before adding a new value:

- **Primary:** `@color/primary`, `primary_light`, `primary_dark`, `primary_container`.
- **Accent:** `@color/secondary`, `secondary_light`, `secondary_dark`, `secondary_container`.
- **Surfaces:** `surface_background` for page backgrounds, `card_background` for grouped content, `surface_variant` for secondary containers, and `card_stroke`/`divider_color` for separation.
- **Text:** `text_primary` for titles and essential values, `text_secondary` for supporting content, `text_tertiary` for captions, and `text_hint` only for hints/placeholders.
- **Status:** use the existing open, pending, closed, locked, and registered color pairs. Never communicate status with color alone; include a label.
- **Spacing:** use `@dimen/spacing_*` on the existing 4dp rhythm. Prefer 16dp screen/card content padding, 20–24dp section separation, and 8–12dp control gaps.
- **Shape/elevation:** use `radius_sm`/`radius_md` for controls and cards, `radius_pill` for status badges/chips, and the lowest elevation that preserves grouping.

## 2. Typography

- Screen title: `TextAppearance.Headline` only for the primary login/app identity; use `TextAppearance.Title` for screen titles and major sections.
- Section title: `TextAppearance.TitleMedium`.
- Main content: `TextAppearance.Body`; supporting values: `BodySmall`; labels/captions: `Label` and `Caption`.
- Keep user-visible text in `strings.xml`; do not hardcode Chinese copy in Activity renderers.
- Preserve sentence-case Chinese labels and avoid all-caps transformations.

## 3. Component anatomy

- **Screen shell:** neutral background, predictable top/back row, one primary content column, and bottom padding that clears system/navigation bars.
- **Card:** one purpose per card, title/value hierarchy, optional status badge, 16dp internal padding, and no nested decorative cards without information value.
- **Primary action:** one clear full-width action per form/detail screen; disabled state must explain why through nearby text or an accessible content description.
- **Secondary action:** supports calendar/reminder/alternate navigation without competing with registration.
- **Input:** visible label, meaningful hint, 48dp minimum touch target, focused/error visual state, and inline validation text.
- **Status badge:** text label plus color pair; use existing status resources and pill shape.
- **Bottom navigation:** preserve four tabs and role visibility. Selected state must be visible through icon, label, and background/tint—not color alone.

## 4. Interaction states

Every core flow screen must define and render the relevant states:

- **Initial:** content is immediately understandable; no empty containers that look broken.
- **Empty:** explain what is empty and provide the next useful action when one exists.
- **Loading:** use a stable in-place affordance and prevent duplicate submissions/navigation.
- **Error:** show an inline, recoverable explanation adjacent to the failed action; Toasts may supplement but cannot be the only feedback.
- **Success:** show one stable result state, preserve the submitted context, and make the next action clear.
- **Disabled/forbidden:** keep the control visible when it teaches availability, explain the restriction, and do not rely on a dead click.

## 5. Motion

- Use existing slide transitions for screen/tab changes and short opacity/translation for newly revealed cards or result panels.
- Motion must communicate navigation, reveal, or state change; do not animate decorative elements.
- Never use motion as the only indication of success, failure, selection, or permission state.
- Keep repeated navigation idempotent: a second tap during a transition must not create duplicate screens or submissions.

## 6. Accessibility and touch behavior

- Preserve meaningful `contentDescription` values for icons and provide text labels for status and actions.
- Keep interactive controls at least 48dp high and keyboard-friendly.
- Do not encode critical meaning only with color, position, or animation.
- Keep focusable/clickable navigation items and ensure disabled controls are announced as disabled.
- Ensure scrollable forms retain access to the submit action when the keyboard is visible.

## 7. Accepted debt and scope

This progressive pass keeps platform Activities, XML layouts, existing Managers, local SQLite/in-memory fallback behavior, and the current Intent-extra contract. The dormant Room/Retrofit/Repository/ViewModel layer, server integration, admin/exhibitor-wide redesign, and full component migration remain deferred. New code should reduce coupling without pretending those deferred layers are active.
