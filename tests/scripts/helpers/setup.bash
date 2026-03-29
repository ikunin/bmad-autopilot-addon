#!/bin/bash
# Common BATS test setup for BMAD bash scripts.
# Source this from each .bats file: load helpers/setup

# Resolve path to scripts directory (relative to the tests/scripts/ dir)
SCRIPTS_DIR="$(cd "$BATS_TEST_DIRNAME/../../_bmad-addons/scripts" && pwd)"

# Create a fresh temporary git repo for each test
setup_temp_repo() {
  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"
  git init --initial-branch=main >/dev/null 2>&1
  git config user.email "test@test.com"
  git config user.name "Test"
  git commit --allow-empty -m "initial commit" >/dev/null 2>&1
}

# Create a temp repo with a bare remote for push testing
setup_temp_repo_with_remote() {
  REMOTE_DIR=$(mktemp -d)
  git init --bare "$REMOTE_DIR" >/dev/null 2>&1

  TEST_DIR=$(mktemp -d)
  cd "$TEST_DIR"
  git init --initial-branch=main >/dev/null 2>&1
  git config user.email "test@test.com"
  git config user.name "Test"
  git commit --allow-empty -m "initial commit" >/dev/null 2>&1
  git remote add origin "$REMOTE_DIR"
  git push -u origin main >/dev/null 2>&1
}

# Cleanup
teardown_temp_repo() {
  cd /tmp || true
  if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR" || true
  fi
  if [ -n "$REMOTE_DIR" ] && [ -d "$REMOTE_DIR" ]; then
    rm -rf "$REMOTE_DIR" || true
  fi
}

# Helper: create a file with content and commit it
commit_file() {
  local file="$1"
  local content="${2:-test content}"
  local msg="${3:-add $file}"
  mkdir -p "$(dirname "$file")"
  echo "$content" > "$file"
  git add -- "$file"
  git commit -m "$msg" >/dev/null 2>&1
}

# Helper: create an uncommitted file (tracked, modified)
modify_file() {
  local file="$1"
  local content="${2:-modified content}"
  echo "$content" > "$file"
}

# Helper: create an untracked file
create_untracked() {
  local file="$1"
  local content="${2:-untracked content}"
  mkdir -p "$(dirname "$file")"
  echo "$content" > "$file"
}
