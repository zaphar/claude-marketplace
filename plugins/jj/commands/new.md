---
description: Create a new jj change
allowed-tools:
  - Bash
---

# jj new

Create a new empty change in the Jujutsu repository.

## Steps

1. Verify this is a jj repository by running `jj root`. If it fails, inform the user this is not a jj repository.
2. Run `jj new` and pass through any arguments the user provided: `$ARGUMENTS`
3. Display the output to the user.
