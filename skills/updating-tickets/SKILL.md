---
name: updating-tickets
description: Use whenever you create, move, comment on or edit a Jira ticket for this team.
---

# Updating tickets

Jira is `arch-os.atlassian.net`, cloudId `673508e9-dd5c-4d06-b78c-f845506c9e03`,
project `KAN`, board 2.

**Find the ticket that is already open for the work before touching any.** It is
the one in the active sprint assigned to the person you work for:
`project = KAN AND sprint in openSprints() AND assignee = currentUser()`, then
match by topic. Older tickets labelled `notion-import` often describe the same
need; they are backlog, not the working ticket. Link them from your comment,
never move or rewrite them. Create a ticket only when nothing matches, and ask
first.

**Status** follows the work: `Idea` → `Zu erledigen` → `In Arbeit` (coding has
started) → `PR` (a pull request is open) → `QS` → `Merged`. `transitionName`
takes the status name.

**A description another person wrote is often locked** (`descriptionEditable:
false`). Put your update in a comment. An assignee change can come back as
success and not stick: read the ticket back.

**The comment** is German and short, for Matthias (load the
`writing-for-matthias` skill when your harness has it):
- The state in one bold first line.
- What is built, with the PR link; what is measured, with numbers.
- Open decisions, each in one line.
- The tickets it also solves, as links.
- Artifact links: claude.ai artifacts are private until he shares them; say so.
