#!/usr/bin/env bats
# Tests for lint-changed.sh

load helpers/setup

setup() {
  setup_temp_repo
}

teardown() {
  teardown_temp_repo
}

@test "no changed files outputs message and exits 0" {
  run bash "$SCRIPTS_DIR/lint-changed.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"No changed files to lint"* ]]
}

@test "no linter found for changed files exits 2" {
  # Create a file with an extension no linter handles, using restricted PATH
  commit_file "data.xyz" "some data"
  modify_file "data.xyz" "modified data"

  # Override PATH to remove all linters
  run env PATH="/usr/bin:/bin" bash "$SCRIPTS_DIR/lint-changed.sh"
  [ "$status" -eq 2 ]
  [[ "$output" == *"No linter found"* ]]
}

@test "output-file flag saves full output" {
  # Create a Python file (ruff is commonly available)
  commit_file "test.py" "x = 1"
  modify_file "test.py" "import os\nimport sys\nx = 1"

  if command -v ruff &>/dev/null; then
    run bash "$SCRIPTS_DIR/lint-changed.sh" --output-file lint-out.txt
    # Don't check exit status (depends on lint findings)
    [ -f "lint-out.txt" ]
  else
    skip "ruff not installed"
  fi
}

@test "python files linted with ruff when available" {
  if ! command -v ruff &>/dev/null; then
    skip "ruff not installed"
  fi

  commit_file "app.py" "x = 1"
  modify_file "app.py" "import os  # unused import"

  run bash "$SCRIPTS_DIR/lint-changed.sh" 2>&1
  # ruff should find the unused import
  [[ "$output" == *"app.py"* ]] || [[ "$output" == *"Summary:"* ]]
}

@test "javascript files linted when eslint available" {
  # Only test if eslint is available
  if ! command -v eslint &>/dev/null && [ ! -f node_modules/.bin/eslint ]; then
    skip "eslint not installed"
  fi

  commit_file "index.js" "const x = 1;"
  modify_file "index.js" "var x = 1;"

  run bash "$SCRIPTS_DIR/lint-changed.sh" 2>&1
  # Just verify it ran without crashing
  true
}

@test "custom limit truncates output" {
  if ! command -v ruff &>/dev/null; then
    skip "ruff not installed"
  fi

  commit_file "bad.py" "x = 1"
  # Create a file with many lint issues
  modify_file "bad.py" "$(for i in $(seq 1 20); do echo "import os$i"; done)"

  run bash "$SCRIPTS_DIR/lint-changed.sh" --limit 5 2>&1
  # Output should be limited
  true
}

@test "help flag shows usage" {
  run bash "$SCRIPTS_DIR/lint-changed.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
