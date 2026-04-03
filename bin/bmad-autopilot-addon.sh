#!/usr/bin/env bash
set -e

# Resolve symlinks so PKG_ROOT points to the actual package directory
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  # Handle relative symlinks
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
PKG_ROOT="$(cd "$(dirname "$SOURCE")/.." && pwd)"
export BMAD_PROJECT_ROOT="${BMAD_PROJECT_ROOT:-$(pwd)}"

COMMAND="${1:-install}"
shift 2>/dev/null || true

case "$COMMAND" in
  install)
    exec bash "$PKG_ROOT/_bmad-addons/install.sh" "$@"
    ;;
  uninstall)
    exec bash "$PKG_ROOT/_bmad-addons/uninstall.sh" "$@"
    ;;
  --version|-v)
    grep 'version:' "$PKG_ROOT/_bmad-addons/manifest.yaml" | head -1 | awk '{print $2}'
    ;;
  -h|--help|help)
    cat <<'EOF'
BMAD Autopilot Add-On

Usage: npx bmad-autopilot-addon <command> [options]

Commands:
  install      Install add-on into current BMAD project (default)
  uninstall    Remove add-on from current project
  help         Show this help
  --version    Show version

Install options:
  --tools <list>   Comma-separated tools (claude-code,cursor,windsurf,cline,roo,trae,kiro,gemini-cli,github-copilot,all)
  --dry-run        Preview without making changes
  --force          Skip backup of existing skills
  --yes, -y        Non-interactive mode

Examples:
  npx bmad-autopilot-addon install
  npx bmad-autopilot-addon install --tools claude-code,cursor --yes
  npx bmad-autopilot-addon uninstall --force
EOF
    ;;
  *)
    echo "Unknown command: $COMMAND (use 'help' for usage)"
    exit 1
    ;;
esac
