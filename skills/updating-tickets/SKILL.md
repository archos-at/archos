---
name: updating-tickets
description: Use whenever you create, move, comment on or edit a Jira ticket for this team.
---

# Updating tickets

- Jira: `arch-os.atlassian.net`, cloudId `673508e9-dd5c-4d06-b78c-f845506c9e03`, project `KAN`.
- The working ticket is in the active sprint, assigned to the user:
  `project = KAN AND sprint in openSprints() AND assignee = currentUser()`.
  `notion-import` tickets on the same topic are backlog: link them, don't move them. Never create one without asking.
- Statuses: `Idea` → `Zu erledigen` → `In Arbeit` → `PR` → `QS` → `Merged`.
- A description someone else wrote is often locked: comment instead. Read back an assignee change; it can fail silently.
- Comment in German: state in one bold line, then PR link, numbers, open decisions, related tickets. claude.ai artifact links are private until shared.
