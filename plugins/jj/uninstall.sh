#!/bin/bash
set -e

# jj Plugin Uninstaller
# Removes the plugin from the current project's .claude/ directory

PROJECT_DIR="${1:-.}"

CLAUDE_DIR_NAME=".claude"

echo "Uninstalling jj Plugin..."
echo "Target project: $PROJECT_DIR"
echo ""

# Remove commands
echo "Removing commands..."
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/commit.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/status.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/log.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/diff.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/new.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/squash.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/describe.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/push.md"
echo "  Commands removed"

# Remove skill
echo "Removing skill..."
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/skills/jj"
echo "  Skill removed"

echo ""
echo "Uninstallation complete!"
