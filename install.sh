#!/bin/bash
set -e

# Rigorous Dev Plugin Installer
# Installs the plugin into the current project's .claude/ directory
# Respects CLAUDE_CONFIG_DIR environment variable

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-.}"

# Project-local plugins always use .claude/ directory
# (CLAUDE_CONFIG_DIR is for global config, not project-local)
CLAUDE_DIR_NAME=".claude"

echo "🔧 Installing Rigorous Dev Plugin..."
echo "Plugin source: $SCRIPT_DIR"
echo "Target project: $PROJECT_DIR"
echo "Claude directory: $CLAUDE_DIR_NAME"
echo ""

# Create directory structure
mkdir -p "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands"
mkdir -p "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents"
mkdir -p "$PROJECT_DIR/$CLAUDE_DIR_NAME/skills"

# Install commands
echo "📦 Installing commands..."
for cmd in "$SCRIPT_DIR/commands"/*.md; do
    cmd_name=$(basename "$cmd")
    ln -sf "$cmd" "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/$cmd_name"
    echo "  ✓ $cmd_name"
done

# Install agents
echo "📦 Installing agents..."
for agent in "$SCRIPT_DIR/agents"/*.md; do
    agent_name=$(basename "$agent")
    ln -sf "$agent" "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/$agent_name"
    echo "  ✓ $agent_name"
done

# Install main skill
echo "📦 Installing rigorous-dev skill..."
ln -sf "$SCRIPT_DIR/skills/rigorous-dev" "$PROJECT_DIR/$CLAUDE_DIR_NAME/skills/rigorous-dev"
echo "  ✓ rigorous-dev skill"

# Copy schemas to project (not symlink, so they're always available)
echo "📦 Copying schemas..."
mkdir -p "$PROJECT_DIR/$CLAUDE_DIR_NAME/rigorous-dev-schemas"
cp "$SCRIPT_DIR/schemas"/*.yaml "$PROJECT_DIR/$CLAUDE_DIR_NAME/rigorous-dev-schemas/"
echo "  ✓ $(ls -1 "$SCRIPT_DIR/schemas" | wc -l | tr -d ' ') schemas copied"

# Create example settings file
echo "📦 Creating example settings..."
if [ ! -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/rigorous-dev.local.md" ]; then
    cp "$SCRIPT_DIR/.claude-rigorous-dev.local.example.md" "$PROJECT_DIR/$CLAUDE_DIR_NAME/rigorous-dev.local.md"
    echo "  ✓ Settings template created at $CLAUDE_DIR_NAME/rigorous-dev.local.md"
else
    echo "  ⊘ Settings file already exists, skipping"
fi

# Update .gitignore
echo "📦 Updating .gitignore..."
if [ -f "$PROJECT_DIR/.gitignore" ]; then
    if ! grep -q "rigorous-dev-state.yaml" "$PROJECT_DIR/.gitignore" 2>/dev/null; then
        cat >> "$PROJECT_DIR/.gitignore" << EOF

# Rigorous Dev Plugin
$CLAUDE_DIR_NAME/rigorous-dev-state.yaml
$CLAUDE_DIR_NAME/rigorous-dev-artifacts/
$CLAUDE_DIR_NAME/rigorous-dev.local.md
EOF
        echo "  ✓ Added rigorous-dev entries to .gitignore"
    else
        echo "  ⊘ .gitignore already has rigorous-dev entries"
    fi
else
    echo "  ⊘ No .gitignore found, skipping"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📚 Next steps:"
echo "1. Restart Claude Code (exit and reopen)"
echo "2. Run: /rigorous-dev:start"
echo "3. Follow the guided workflow"
echo ""
echo "📖 Documentation: $SCRIPT_DIR/README.md"
echo "⚙️  Settings: $CLAUDE_DIR_NAME/rigorous-dev.local.md"
