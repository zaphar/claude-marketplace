---
description: Show jj revision log
allowed-tools:
  - Bash
---

# jj log

Show the Jujutsu revision log.

## Steps

1. Verify this is a jj repository by running `jj root`. If it fails, inform the user this is not a jj repository.
2. Run `jj log` and pass through any arguments the user provided: `$ARGUMENTS`
3. Display the output to the user.
