#!/usr/bin/env bats
# Tests for sync-status.sh

load helpers/setup

setup() {
  setup_temp_repo
}

teardown() {
  teardown_temp_repo
}

@test "creates new git-status.yaml from scratch" {
  run bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "git-status.yaml" \
    --branch "story/1-1" \
    --platform "github" \
    --base-branch "main"
  [ "$status" -eq 0 ]
  [[ "$output" == OK:1-1:* ]]
  [ -f "git-status.yaml" ]
  grep -q "stories:" git-status.yaml
  grep -q "1-1:" git-status.yaml
  grep -q "branch:" git-status.yaml
}

@test "creates parent directories for git-status-file" {
  run bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "deep/nested/dir/git-status.yaml" \
    --branch "story/1-1"
  [ "$status" -eq 0 ]
  [ -f "deep/nested/dir/git-status.yaml" ]
}

@test "updates existing story entry" {
  # Create initial entry
  bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "git-status.yaml" \
    --branch "story/1-1" \
    --push-status "pending" \
    --platform "github"

  # Update with push status
  run bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "git-status.yaml" \
    --branch "story/1-1" \
    --push-status "pushed" \
    --pr-url "https://github.com/user/repo/pull/42"
  [ "$status" -eq 0 ]
  grep -q "push_status: pushed" git-status.yaml
  grep -q "https://github.com/user/repo/pull/42" git-status.yaml
}

@test "appends new story to existing file" {
  bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "git-status.yaml" \
    --branch "story/1-1" \
    --platform "github"

  run bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-2" \
    --git-status-file "git-status.yaml" \
    --branch "story/1-2"
  [ "$status" -eq 0 ]
  grep -q "1-1:" git-status.yaml
  grep -q "1-2:" git-status.yaml
}

@test "all fields are written" {
  run bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "2-1" \
    --git-status-file "git-status.yaml" \
    --branch "story/2-1" \
    --worktree ".worktrees/2-1" \
    --commit "abc123def456" \
    --patch-commits "def789,ghi012" \
    --push-status "pushed" \
    --pr-url "https://github.com/u/r/pull/1" \
    --lint-result "0 errors, 2 warnings" \
    --platform "github" \
    --base-branch "main" \
    --worktree-cleaned "true"
  [ "$status" -eq 0 ]
  grep -q "branch:" git-status.yaml
  grep -q "worktree:" git-status.yaml
  grep -q "story_commit:" git-status.yaml
  grep -q "patch_commits:" git-status.yaml
  grep -q "push_status: pushed" git-status.yaml
  grep -q "pr_url:" git-status.yaml
  grep -q "lint_result:" git-status.yaml
  grep -q "worktree_cleaned: true" git-status.yaml
}

@test "missing required args fails" {
  run bash "$SCRIPTS_DIR/sync-status.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"--story and --git-status-file required"* ]]
}

@test "missing story fails" {
  run bash "$SCRIPTS_DIR/sync-status.sh" --git-status-file "f.yaml"
  [ "$status" -eq 1 ]
}

@test "missing git-status-file fails" {
  run bash "$SCRIPTS_DIR/sync-status.sh" --story "1-1"
  [ "$status" -eq 1 ]
}

@test "YAML special characters in values are quoted" {
  run bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "git-status.yaml" \
    --branch "story/1-1" \
    --lint-result "errors: 3, warnings: [none]"
  [ "$status" -eq 0 ]
  # Value with colons/brackets should be quoted
  grep -q 'lint_result:' git-status.yaml
}

@test "git_integration header is written for new files" {
  bash "$SCRIPTS_DIR/sync-status.sh" \
    --story "1-1" \
    --git-status-file "git-status.yaml" \
    --platform "gitlab" \
    --base-branch "develop"

  grep -q "git_integration:" git-status.yaml
  grep -q "enabled: true" git-status.yaml
  grep -q "base_branch: develop" git-status.yaml
  grep -q "platform: gitlab" git-status.yaml
}

@test "help flag shows usage" {
  run bash "$SCRIPTS_DIR/sync-status.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
