---
description: Show jj diff for changes
allowed-tools:
  - Bash
---

# jj diff

Show the diff of changes in the Jujutsu repository.

## Steps

1. Verify this is a jj repository by running `jj root`. If it fails, inform the user this is not a jj repository.
2. Run `jj diff --git` and pass through any arguments the user provided: `$ARGUMENTS`
3. Display the output to the user.
