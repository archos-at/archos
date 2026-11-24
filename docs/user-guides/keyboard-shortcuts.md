# Keyboard shortcuts

ARCHOS can be driven from the keyboard: open the search, jump between
sections, and work the composer without reaching for the mouse. Press **?**
anywhere in the app to see the full set — the cheatsheet is generated from the
same registry the app binds, so it is never out of date with what actually works.

## Two gates

Shortcuts are only active when both of these allow it:

1. **An organization.** The shortcuts navigate inside one, so a session without
   an organization (onboarding, a break-glass session) never mounts the client
   code and no key listener exists.
2. **Your own preference.** Profile → *Keyboard shortcuts* is a per-device toggle,
   default on. Turned off, the app registers zero key listeners and does not
   render the cheatsheet. The search window stays, because the magnifier in the
   sidebar opens it too.

Plain-key shortcuts never fire while you are typing (in a text field, a text
area, a select, or any editable region) and never while a modifier is held, so
they cannot swallow what you meant to type. ⌘K is the one exception and works
everywhere.

## General

| Shortcut | What it does |
|---|---|
| **⌘K** / **Ctrl+K** | Open (or close) the search |
| **?** | Show the shortcuts cheatsheet |
| **Esc** | Close a dialog, panel or menu |

The modifier is shown as **⌘** on Apple platforms and **Ctrl** everywhere else;
the cheatsheet resolves it for the machine you are on.

## Jumping around (`g` then a key)

Press **G**, release it, then press the destination key within a second and a
half. The destinations are the sections of the navigation rail, and the search
page with its filters:

| Sequence | Destination |
|---|---|
| **G** then **P** | All projects |
| **G** then **O** | Organization |
| **G** then **C** | Ask ARCHOS (chat) |
| **G** then **W** | Skills |
| **G** then **F** | Files |
| **G** then **K** | Knowledge |
| **G** then **H** | History |
| **G** then **A** | Büroablage |
| **G** then **I** | Inbox |
| **G** then **S** | Project settings |

Rows for sections your organization has not enabled do not appear in the
cheatsheet and their keys do nothing — the sheet always shows your set, not a
generic one.

Section jumps open that section of the project you are currently in. Outside a
project there is nothing for them to open, so they do nothing rather than
guessing a project for you. *All projects*, *Organization*, *Büroablage* and *Inbox*
are org-wide doorways and work from anywhere.

A second key that is not bound simply cancels the sequence. Nothing navigates
unless you asked for it.

## In the chat

| Shortcut | What it does |
|---|---|
| **Enter** or **⌘Enter** | Send the message |
| **Shift+Enter** | New line |
| **@** | Mention a colleague (where collaboration is enabled) |
| **1**–**9** | Pick a numbered option when ARCHOS asks you to choose |

While the mention picker is open it owns the navigation keys: ↑/↓ move the
selection, Tab or Enter inserts the name, and Escape dismisses the picker without
closing the chat around it. Enter never sends a message while the picker is open.

## In the inbox

While the inbox is open (and you are not typing in a field), it can be worked
without the mouse:

| Shortcut | What it does |
|---|---|
| **J** / **K** | Move to the next or previous item |
| **Enter** | Open the item (and mark it read) |
| **E** | Archive the item (Undo stays on offer for a few seconds); under *Archived*, restore it |
| **U** | Mark the item read, or unread again |

## In the E-Mail-Eingang

While a project's E-Mail-Eingang is open (and you are not typing in a field).
Listed in the cheatsheet only for offices with project mail:

| Shortcut | What it does |
|---|---|
| **J** / **K** | Next or previous mail |
| **Enter** | Open the mail |
| **X** | Select the mail for a bulk action (never a mail that poses as someone) |
| **Space** | Preview the attachment |
| **E** | Review and file, and in its overview: file („Einordnen“, in der Übersicht „Ablegen“) |
| **⌫** | Dismiss the mail |

## The search window

⌘K and the magnifier at the top of the sidebar open the same window. The field
finds files, chats and projects across the whole office, also from inside a
project, and the line under it narrows to one kind (Alles, Dateien, Chats,
Projekte) and says where it searches („im ganzen Büro“). Before anything is
typed it lists what you opened from this window last (kept in this browser,
per person and office), then the general entries under „Allgemein“: a new
project, all projects, the organisation, the profile, the theme and sign-out. Typing a general entry's name finds it below the hits.
With hits, the last row opens all of them on the search page with its filters,
narrowed to the chosen kind (⌘↵ from any row, and from an empty field the page
as it is); that page has no entry in the sidebar any more. The window no longer lists projects or the sections of the
current project: projects are found by typing, sections by their `g` jumps.

## For maintainers

The bindings and the cheatsheet share one source of truth,
`apps/workspace/ui/components/shell/shortcuts.ts`. Its navigation half is derived
from `project-sections.ts` — the same module the rail renders — via
each section's `shortcutKey`. Adding a section with a `shortcutKey` therefore
gives it a working jump and a cheatsheet row (with the rail's own label and icon)
in one step, and a flag-gated section disappears from the sheet exactly when it
disappears from the rail. Shortcuts implemented elsewhere (the composer's, the
choice prompt's, Radix's Escape) are declared in the registry with an `owner`, so
the sheet can document them honestly without the shell pretending to bind them.
