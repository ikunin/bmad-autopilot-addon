#!/usr/bin/env bats
# Tests for health-check.sh

load helpers/setup

setup() {
  setup_temp_repo_with_remote
}

teardown() {
  teardown_temp_repo
}

@test "no worktrees dir returns empty summary" {
  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir "nonexistent"
  [ "$status" -eq 0 ]
  [ "$output" = "SUMMARY:0:0:0:0:0:0" ]
}

@test "empty worktrees dir returns empty summary" {
  mkdir -p .claude/worktrees
  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUMMARY:0:0:0:0:0:0"* ]]
}

@test "clean worktree with done status classified as CLEAN_DONE" {
  # Create a worktree
  git worktree add .claude/worktrees/story-1 -b story/story-1 >/dev/null 2>&1

  # Create a sprint status file marking story as done
  mkdir -p _bmad-output/implementation-artifacts
  cat > status.yaml <<'EOF'
  story-1:
    status: done
EOF

  run bash "$SCRIPTS_DIR/health-check.sh" \
    --worktrees-dir ".claude/worktrees" \
    --status-file "status.yaml"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CLEAN_DONE:story-1"* ]]
  [[ "$output" == *"SUMMARY:1:1:0:0:0:0"* ]]
}

@test "worktree with uncommitted changes classified as DIRTY" {
  git worktree add .claude/worktrees/story-2 -b story/story-2 >/dev/null 2>&1
  echo "dirty content" > .claude/worktrees/story-2/dirty-file.txt

  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"DIRTY:story-2"* ]]
}

@test "worktree with commits ahead classified as COMMITTED" {
  git worktree add .claude/worktrees/story-3 -b story/story-3 >/dev/null 2>&1
  cd .claude/worktrees/story-3
  echo "new work" > work.txt
  git add work.txt
  git commit -m "story work" >/dev/null 2>&1
  cd "$TEST_DIR"

  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"COMMITTED:story-3"* ]]
}

@test "worktree with no commits ahead classified as STALE" {
  git worktree add .claude/worktrees/story-4 -b story/story-4 >/dev/null 2>&1

  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE:story-4"* ]]
}

@test "non-worktree directory classified as DIRTY (inherits parent git context)" {
  # A plain directory inside worktrees/ is not a real worktree, but git -C
  # finds the parent repo's .git, so it gets classified based on parent state.
  # The untracked file makes it appear DIRTY from the parent's perspective.
  # TODO: health-check.sh should use `git worktree list` to verify real worktrees
  mkdir -p .claude/worktrees/orphan-dir
  echo "not a git repo" > .claude/worktrees/orphan-dir/file.txt

  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"DIRTY:orphan-dir"* ]]
}

@test "detached HEAD classified as ORPHAN" {
  git worktree add .claude/worktrees/detached -b temp-branch >/dev/null 2>&1
  cd .claude/worktrees/detached
  local sha=$(git rev-parse HEAD)
  git checkout "$sha" >/dev/null 2>&1
  cd "$TEST_DIR"

  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ORPHAN:detached"* ]]
}

@test "mixed worktree statuses produce correct summary" {
  # STALE worktree
  git worktree add .claude/worktrees/stale-one -b story/stale-one >/dev/null 2>&1

  # DIRTY worktree
  git worktree add .claude/worktrees/dirty-one -b story/dirty-one >/dev/null 2>&1
  echo "dirty" > .claude/worktrees/dirty-one/x.txt

  run bash "$SCRIPTS_DIR/health-check.sh" --worktrees-dir ".claude/worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE:stale-one"* ]]
  [[ "$output" == *"DIRTY:dirty-one"* ]]
  # SUMMARY:total:clean:committed:stale:dirty:orphan
  [[ "$output" == *"SUMMARY:2:0:0:1:1:0"* ]]
}

@test "custom base branch works" {
  git checkout -b develop >/dev/null 2>&1
  git push -u origin develop >/dev/null 2>&1
  git worktree add .claude/worktrees/story-x -b story/story-x >/dev/null 2>&1

  run bash "$SCRIPTS_DIR/health-check.sh" \
    --worktrees-dir ".claude/worktrees" \
    --base-branch "develop"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE:story-x"* ]]
}

@test "help flag shows usage" {
  run bash "$SCRIPTS_DIR/health-check.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
