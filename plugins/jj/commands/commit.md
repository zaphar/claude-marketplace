---
description: Auto-analyze changes and commit with a generated message
allowed-tools:
  - Bash
  - Read
---

# jj commit

Analyze the current working-copy changes and commit with an auto-generated message.

## Steps

### 1. Verify Repository

Run `jj root`. If it fails, inform the user this is not a jj repository and stop.

### 2. Gather Information

Run these commands in parallel to understand the current state:
- `jj status` to see modified/added/deleted files
- `jj diff` to see the actual changes
- `jj log -r 'ancestors(@, 10)' --no-graph` to see recent commit message style

### 3. Check for Changes

If the diff is empty (no changes in working copy), inform the user there is nothing to commit and stop.

### 4. Analyze Changes

Examine the diff output and categorize the changes:
- `feat:` for new features or functionality
- `fix:` for bug fixes
- `refactor:` for code restructuring without behavior changes
- `docs:` for documentation-only changes
- `chore:` for build, CI, dependency, or maintenance changes
- `wip:` for incomplete work in progress

### 5. Generate Commit Message

Create a concise one-sentence commit message using the `<prefix>: <description>` format. Match the style of recent messages from the log. Focus on the "why" rather than the "what".

### 6. Execute Commit

Use a heredoc for shell safety:

```bash
jj commit -m "$(cat <<'EOF'
<generated message>
EOF
)"
```

### 7. Verify and Report

Run `jj log -r 'ancestors(@, 3)' --no-graph` to show the commit was created.

Display a summary:
- The generated commit message
- Files that were changed
- The new change ID
