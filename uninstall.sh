#!/bin/bash
set -e

# Rigorous Dev Plugin Uninstaller
# Removes the plugin from the current project's .claude/ directory
# Respects CLAUDE_CONFIG_DIR environment variable

PROJECT_DIR="${1:-.}"

# Project-local plugins always use .claude/ directory
# (CLAUDE_CONFIG_DIR is for global config, not project-local)
CLAUDE_DIR_NAME=".claude"

echo "🗑️  Uninstalling Rigorous Dev Plugin..."
echo "Target project: $PROJECT_DIR"
echo "Claude directory: $CLAUDE_DIR_NAME"
echo ""

# Remove commands
echo "🧹 Removing commands..."
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/start.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/resume.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/status.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/commands/skip-to.md"
echo "  ✓ Commands removed"

# Remove agents
echo "🧹 Removing agents..."
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/requirements_interviewer.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/requirements_analyst.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/requirements_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/ux_designer.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/ux_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/backend_architect.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/architecture_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/implementation_planner.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/implementation_plan_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/senior_developer.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/senior_developer_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/qa_engineer.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/qa_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/documentation_master.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/documentation_critic.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/release_engineer.md"
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/agents/release_critic.md"
echo "  ✓ Agents removed"

# Remove skill
echo "🧹 Removing skill..."
rm -f "$PROJECT_DIR/$CLAUDE_DIR_NAME/skills/rigorous-dev"
echo "  ✓ Skill removed"

# Remove schemas
echo "🧹 Removing schemas..."
rm -rf "$PROJECT_DIR/$CLAUDE_DIR_NAME/rigorous-dev-schemas"
echo "  ✓ Schemas removed"

# Note: We don't remove rigorous-dev.local.md or workflow state
# to preserve user data

echo ""
echo "✅ Uninstallation complete!"
echo ""
echo "⚠️  Preserved (not removed):"
echo "- $CLAUDE_DIR_NAME/rigorous-dev.local.md (your settings)"
echo "- $CLAUDE_DIR_NAME/rigorous-dev-state.yaml (workflow state)"
echo "- $CLAUDE_DIR_NAME/rigorous-dev-artifacts/ (your artifacts)"
echo ""
echo "To fully remove including data, run:"
echo "  rm -rf $CLAUDE_DIR_NAME/rigorous-dev*"
