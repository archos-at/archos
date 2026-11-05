/**
 * Focus ring — the two recipes, written once.
 *
 * A keyboard ring that changes alpha, offset and trigger (`focus:` vs
 * `focus-visible:`) from control to control is not a style choice, it is noise:
 * the reader has to re-learn "where am I?" on every widget, and one of the
 * variants (`focus:`) fires on a MOUSE CLICK, which teaches them the ring means
 * nothing. So there are exactly two, and every interactive primitive in
 * `components/ui` composes one of them rather than hand-rolling a third.
 *
 * The ring is ink (`--ring`), never blue — see `docs/design/design-language.md`
 * ("Focus ring is ink-based, never blue").
 */

/**
 * **Interactive controls** — buttons, chips, toggles, tabs, badges, menu
 * triggers, close buttons, drag handles.
 *
 * A 2px ink ring held off the control by a 2px background-coloured gap, so it
 * reads on a filled (near-black) button as clearly as on a ghost one. `/60`
 * because a full-strength ink ring on a dense toolbar reads as a second border.
 */
export const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

/**
 * **Interactive controls that sit inside a clipping container** — list rows in
 * `ItemList`, which is `overflow-hidden`, so an offset ring on the first or last
 * row would be sliced off by the container's own rounded edge and the reader
 * would see three sides of a rectangle. Same ring, drawn inside the row's box.
 */
export const FOCUS_RING_INSET = 'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset'

/**
 * **Fields**: `Input`, `Textarea`, `Select` trigger, the chat composer, every
 * search bar, and anything else that is a typing surface.
 *
 * THE DOCUMENTED EXCEPTION to {@link FOCUS_RING}, and deliberate: a field
 * already carries a visible border at rest, so focus is that border turning to
 * `--ring`, and nothing more. No halo, and not the app's global keyboard
 * outline either (`globals.css`, unlayered, hence the `!`): a text field shows
 * `:focus-visible` on a mouse click too, so every click into a field drew the
 * ink border, a 2px halo and a 2px outline 2px outside it, three bands where
 * the reader wanted a caret (Notion #38, „Texteingabefelder bekommen beim
 * Anklicken eine zu dicke Markierung"). The ink border alone is above 3:1
 * against the paper and against the resting border, in both themes (5.8:1 and
 * 4.5:1 light, 5.5:1 and 3.3:1 on the dark well), so it is the indicator WCAG
 * 2.4.7 asks for. `outline-hidden` rather than `outline-none`: in forced colours
 * the transparent outline is drawn, so a Windows high-contrast reader keeps one.
 *
 * A focus snaps: no field names `border-color` in its transition list
 * (design-language.md, "A focus ring snaps").
 */
export const FIELD_FOCUS_RING = 'focus-visible:border-ring focus-visible:outline-hidden!'

/**
 * **A field made of several parts**: `TagInput`, `MultiSelect`, the chat
 * composer, where the typing surface (or the trigger) is a bare control inside
 * a bordered box. The box is the field, so the box takes
 * {@link FIELD_FOCUS_RING}'s treatment, keyed on the focus inside it, and the
 * bare `<input>` / `<textarea>` inside draws no outline of its own (a second
 * box inside the first). `:focus-within` and not `:has(:focus-visible)`: a text
 * input shows focus-visible on a click too, so the two agree, and this one is
 * older.
 */
export const FIELD_FOCUS_WITHIN_RING =
  'focus-within:border-ring [&_:is(input,textarea):focus-visible]:outline-hidden!'
