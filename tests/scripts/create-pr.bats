#!/usr/bin/env bats
# Tests for create-pr.sh

load helpers/setup

setup() {
  setup_temp_repo
}

teardown() {
  teardown_temp_repo
}

@test "git_only platform returns SKIPPED and exits 2" {
  git remote add origin "https://example.com/repo.git"
  run bash "$SCRIPTS_DIR/create-pr.sh" \
    --platform git_only \
    --branch "story/1-1" \
    --title "Test PR"
  [ "$status" -eq 2 ]
  [[ "${lines[0]}" == "SKIPPED" ]]
}

@test "missing required flags exits 1" {
  run bash "$SCRIPTS_DIR/create-pr.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"--platform, --branch, and --title are required"* ]]
}

@test "missing branch flag exits 1" {
  run bash "$SCRIPTS_DIR/create-pr.sh" --platform github --title "Test"
  [ "$status" -eq 1 ]
}

@test "missing title flag exits 1" {
  run bash "$SCRIPTS_DIR/create-pr.sh" --platform github --branch "story/1-1"
  [ "$status" -eq 1 ]
}

@test "no remote configured returns SKIPPED and exits 2" {
  run bash "$SCRIPTS_DIR/create-pr.sh" \
    --platform github \
    --branch "story/1-1" \
    --title "Test PR"
  [ "$status" -eq 2 ]
  [[ "${lines[0]}" == "SKIPPED" ]]
}

@test "dry-run prints info without creating PR" {
  git remote add origin "https://github.com/user/repo.git"
  run bash "$SCRIPTS_DIR/create-pr.sh" \
    --platform github \
    --branch "story/1-1" \
    --base main \
    --title "Test PR" \
    --body "Test body" \
    --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]]
  [[ "$output" == *"story/1-1"* ]]
  [[ "$output" == *"Test PR"* ]]
}

@test "unknown platform exits 1" {
  git remote add origin "https://example.com/repo.git"
  run bash "$SCRIPTS_DIR/create-pr.sh" \
    --platform "unknown_platform" \
    --branch "story/1-1" \
    --title "Test"
  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown platform"* ]]
}

@test "help flag shows usage" {
  run bash "$SCRIPTS_DIR/create-pr.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
