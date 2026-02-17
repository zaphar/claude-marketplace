---
name: Jujutsu Version Control
description: Auto-trigger when version control topics arise in jj repositories. Provides jj concepts, git-to-jj mappings, and available commands.
version: 0.1.0
---

# Jujutsu (jj) Version Control

This skill provides knowledge about Jujutsu version control for working in jj repositories.

## Key Concepts

- **Changes vs Commits**: In jj, you work with *changes* (mutable) that become *commits* (immutable once pushed). The working copy (`@`) is always a change.
- **No staging area**: All file modifications are automatically part of the current change. There is no `git add` equivalent.
- **Bookmarks**: jj uses *bookmarks* instead of git branches. A bookmark is a named pointer to a change.
- **Revsets**: jj has a powerful revision selection language. Common examples: `@` (working copy), `@-` (parent), `ancestors(@, 5)` (last 5 ancestors).
- **Change IDs vs Commit IDs**: Changes have a stable change ID that persists across rewrites. Commit IDs change when a commit is rewritten.

## Git-to-jj Command Mapping

| Git | jj | Notes |
|---|---|---|
| `git status` | `jj status` | Shows working copy changes |
| `git diff` | `jj diff` | Diff of working copy |
| `git diff --staged` | `jj diff -r @` | Same as above (no staging area) |
| `git log` | `jj log` | Revision log |
| `git add && git commit` | `jj commit` | No add step needed |
| `git commit --amend` | `jj describe` or `jj squash` | `describe` changes message, `squash` folds changes into parent |
| `git branch` | `jj bookmark` | Create/list/delete bookmarks |
| `git push` | `jj git push` | Push bookmarks to remote |
| `git pull` | `jj git fetch && jj rebase` | Fetch then rebase |
| `git stash` | Not needed | Working copy is always a change |
| `git checkout` | `jj new <rev>` or `jj edit <rev>` | `new` creates child, `edit` modifies in place |
| `git rebase` | `jj rebase` | Rebase changes |
| `git merge` | `jj new <rev1> <rev2>` | Create merge change |

## Common Workflows

### Commit current changes
```bash
jj commit -m "feat: add new feature"
```

### Amend the current change description
```bash
jj describe -m "fix: correct typo in error message"
```

### Squash working copy into parent
```bash
jj squash
```

### Push to remote
```bash
jj bookmark create my-feature -r @
jj git push --bookmark my-feature
```

### Split a change
```bash
jj split  # Interactive split of current change
```

### View change details
```bash
jj show @    # Show current change
jj show @-   # Show parent change
```

## Commit Message Conventions

This project uses the `<prefix>: <description>` format:
- `feat:` - New features
- `fix:` - Bug fixes
- `refactor:` - Code restructuring
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `wip:` - Work in progress

Keep messages concise and focused on the "why".

## Available Commands

- `/jj:commit` - Auto-analyze changes and commit with generated message
- `/jj:status` - Show repository status
- `/jj:log` - Show revision log
- `/jj:diff` - Show diff of changes
- `/jj:new` - Create a new change
- `/jj:squash` - Squash changes into parent
- `/jj:describe` - Set or auto-generate a change description
- `/jj:push` - Push bookmarks to remote
