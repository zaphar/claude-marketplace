#!/bin/bash
set -e

# jj Plugin Installer
# Installs the plugin into the current project's .claude/ directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-.}"

CLAUDE_DIR_NAME=".claude"

echo "Installing jj Plugin..."
echo "Plugin source: $SCRIPT_DIR"
echo "Target project: $PROJECT_DIR"
echo ""

# Create directory structure
mkdir -p "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands"
mkdir -p "$PROJECT_DIR/$CLAUDE_DIR_NAME/skills"

# Install commands
echo "Installing commands..."
for cmd in "$SCRIPT_DIR/commands"/*.md; do
    cmd_name=$(basename "$cmd")
    ln -sf "$cmd" "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/$cmd_name"
    echo "  $cmd_name"
done

# Install skill
echo "Installing jj skill..."
ln -sf "$SCRIPT_DIR/skills/jj" "$PROJECT_DIR/$CLAUDE_DIR_NAME/skills/jj"
echo "  jj skill"

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Restart Claude Code (exit and reopen)"
echo "2. Use /jj:commit, /jj:status, /jj:log, etc."
