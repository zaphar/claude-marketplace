---
description: Push bookmarks to remote
allowed-tools:
  - Bash
  - Read
---

# jj push

Push changes to a remote by managing bookmarks and running `jj git push`.

## Steps

### 1. Verify Repository

Run `jj root`. If it fails, inform the user this is not a jj repository and stop.

### 2. Check Current State

Run in parallel:
- `jj status` to check working copy state
- `jj log -r @ --no-graph` to see current change

### 3. Check for Uncommitted Changes

If working copy has modifications (non-empty diff from `jj diff`), warn the user:
> Working copy has uncommitted changes. Run `/jj:commit` first, or `/jj:describe` to set a description before pushing.

Stop and let the user decide.

### 4. Determine Target Change

- If `@` has an empty description (just created with `jj new`), target `@-` instead
- Otherwise target `@`

Check the target with `jj log -r <target> --no-graph`.

### 5. Check for Existing Bookmark

Run `jj log -r <target> --no-graph -T 'bookmarks'` to see if the target already has a bookmark.

If a bookmark exists, use it. Skip to step 7.

### 6. Create Bookmark (if needed)

Generate a bookmark name from the change description:
- Take the first line of the description
- Extract the prefix (e.g., `feat`, `fix`) and a slug of the description
- Format as `<prefix>/<slugified-description>` (e.g., `feat/add-user-auth`)
- Limit to 50 characters, use only `[a-z0-9/-]`

Create the bookmark:

```bash
jj bookmark create <name> -r <target>
```

### 7. Push

Run the push:

```bash
jj git push --bookmark <bookmark-name>
```

### 8. Report

Display the result:
- Which bookmark was pushed
- Which remote it was pushed to
- The change ID that was pushed
