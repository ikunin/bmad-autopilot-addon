#!/usr/bin/env bats
# Tests for sanitize-branch.sh

load helpers/setup

setup() {
  setup_temp_repo
}

teardown() {
  teardown_temp_repo
}

@test "simple story key passes through" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "1-3"
  [ "$status" -eq 0 ]
  [ "$output" = "1-3" ]
}

@test "upppercase is lowered" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "My-Story"
  [ "$status" -eq 0 ]
  [ "$output" = "my-story" ]
}

@test "spaces become hyphens" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "my story key"
  [ "$status" -eq 0 ]
  [ "$output" = "my-story-key" ]
}

@test "special characters are stripped" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "feat: add @auth!"
  [ "$status" -eq 0 ]
  [ "$output" = "feat-add-auth" ]
}

@test "ampersands and parens become hyphens" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "foo & bar (baz)"
  [ "$status" -eq 0 ]
  [ "$output" = "foo-bar-baz" ]
}

@test "consecutive hyphens are collapsed" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "a--b---c"
  [ "$status" -eq 0 ]
  [ "$output" = "a-b-c" ]
}

@test "leading and trailing hyphens are stripped" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "-leading-trailing-"
  [ "$status" -eq 0 ]
  [ "$output" = "leading-trailing" ]
}

@test "leading and trailing dots are stripped" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" ".dotted."
  [ "$status" -eq 0 ]
  [ "$output" = "dotted" ]
}

@test "long name is truncated with hash" {
  LONG_NAME="this-is-a-very-long-story-key-that-exceeds-the-sixty-character-limit-for-branch-names"
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "$LONG_NAME"
  [ "$status" -eq 0 ]
  # Output should be <= 60 chars
  [ "${#output}" -le 60 ]
  # Should end with a 6-char hash
  [[ "$output" =~ -[a-f0-9]{6}$ ]]
}

@test "custom max-length is respected" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "a-moderately-long-name" --max-length 15
  [ "$status" -eq 0 ]
  [ "${#output}" -le 15 ]
}

@test "empty key after sanitization fails" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "!@#\$%"
  [ "$status" -eq 1 ]
  [[ "$output" == *"empty branch name"* ]]
}

@test "missing story key fails" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"story key required"* ]]
}

@test "custom prefix is used for validation" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "my-feature" --prefix "feature/"
  [ "$status" -eq 0 ]
  [ "$output" = "my-feature" ]
}

@test "branch collision appends counter" {
  # Create an existing branch that would collide
  git checkout -b "story/my-story" >/dev/null 2>&1
  git checkout main >/dev/null 2>&1

  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "my-story"
  [ "$status" -eq 0 ]
  [ "$output" = "my-story-2" ]
}

@test "multiple branch collisions increment counter" {
  git checkout -b "story/my-story" >/dev/null 2>&1
  git checkout main >/dev/null 2>&1
  git checkout -b "story/my-story-2" >/dev/null 2>&1
  git checkout main >/dev/null 2>&1

  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "my-story"
  [ "$status" -eq 0 ]
  [ "$output" = "my-story-3" ]
}

@test "help flag shows usage" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "numeric story key works" {
  run bash "$SCRIPTS_DIR/sanitize-branch.sh" "42"
  [ "$status" -eq 0 ]
  [ "$output" = "42" ]
}
