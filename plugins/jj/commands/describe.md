---
description: Set or auto-generate a change description
allowed-tools:
  - Bash
  - Read
---

# jj describe

Set or auto-generate a description for the current change.

## Steps

### 1. Verify Repository

Run `jj root`. If it fails, inform the user this is not a jj repository and stop.

### 2. Check for User-Provided Message

If the user provided arguments (`$ARGUMENTS`) that contain a message, use it directly:

```bash
jj describe -m "<user message>"
```

Then show the result with `jj log -r @ --no-graph` and stop.

### 3. Auto-Generate Description

If no message was provided, analyze the current change to generate one.

Gather information in parallel:
- `jj diff -r @` to see what changed
- `jj log -r 'ancestors(@, 10)' --no-graph` to see recent commit message style

### 4. Generate Message

Based on the diff, categorize the change and generate a concise description using the `<prefix>: <description>` convention:
- `feat:` for new features
- `fix:` for bug fixes
- `refactor:` for code restructuring
- `docs:` for documentation changes
- `chore:` for maintenance tasks
- `wip:` for work in progress

Match the style of recent messages from the log. Keep the description to one sentence.

### 5. Apply Description

Run the describe command using a heredoc for shell safety:

```bash
jj describe -m "$(cat <<'EOF'
<generated message>
EOF
)"
```

### 6. Confirm

Show the result with `jj log -r @ --no-graph` and display the description that was set.
