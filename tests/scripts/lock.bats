#!/usr/bin/env bats
# Tests for lock.sh

load helpers/setup

setup() {
  setup_temp_repo
}

teardown() {
  teardown_temp_repo
}

@test "check on free returns FREE" {
  run bash "$SCRIPTS_DIR/lock.sh" check
  [ "$status" -eq 0 ]
  [ "$output" = "FREE" ]
}

@test "acquire on free succeeds" {
  run bash "$SCRIPTS_DIR/lock.sh" acquire
  [ "$status" -eq 0 ]
  [[ "$output" == ACQUIRED:* ]]
  [ -f ".autopilot.lock" ]
}

@test "check after acquire returns LOCKED" {
  bash "$SCRIPTS_DIR/lock.sh" acquire >/dev/null
  run bash "$SCRIPTS_DIR/lock.sh" check
  [ "$status" -eq 0 ]
  [[ "$output" == LOCKED:* ]]
}

@test "double acquire fails with LOCKED" {
  bash "$SCRIPTS_DIR/lock.sh" acquire >/dev/null
  run bash "$SCRIPTS_DIR/lock.sh" acquire
  [ "$status" -eq 1 ]
  [[ "$output" == LOCKED:* ]]
}

@test "release after acquire succeeds" {
  bash "$SCRIPTS_DIR/lock.sh" acquire >/dev/null
  run bash "$SCRIPTS_DIR/lock.sh" release
  [ "$status" -eq 0 ]
  [ "$output" = "RELEASED" ]
  [ ! -f ".autopilot.lock" ]
}

@test "release when no lock returns NO_LOCK" {
  run bash "$SCRIPTS_DIR/lock.sh" release
  [ "$status" -eq 0 ]
  [ "$output" = "NO_LOCK" ]
}

@test "stale lock is auto-acquired" {
  # Create a lock with a timestamp 31+ minutes ago
  local old_time=$(( $(date +%s) - 1900 ))
  printf '%s\nstale-session-id\n' "$old_time" > .autopilot.lock

  run bash "$SCRIPTS_DIR/lock.sh" acquire
  [ "$status" -eq 0 ]
  [[ "$output" == ACQUIRED_STALE:* ]]
}

@test "stale lock detected by check" {
  local old_time=$(( $(date +%s) - 1900 ))
  printf '%s\nstale-session-id\n' "$old_time" > .autopilot.lock

  run bash "$SCRIPTS_DIR/lock.sh" check
  [ "$status" -eq 0 ]
  [[ "$output" == STALE:* ]]
}

@test "status on free shows free message" {
  run bash "$SCRIPTS_DIR/lock.sh" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"free"* ]]
}

@test "status on locked shows ACTIVE" {
  bash "$SCRIPTS_DIR/lock.sh" acquire >/dev/null
  run bash "$SCRIPTS_DIR/lock.sh" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"ACTIVE"* ]]
}

@test "status on stale shows STALE" {
  local old_time=$(( $(date +%s) - 1900 ))
  printf '%s\nstale-session-id\n' "$old_time" > .autopilot.lock

  run bash "$SCRIPTS_DIR/lock.sh" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE"* ]]
}

@test "custom lock file path works" {
  run bash "$SCRIPTS_DIR/lock.sh" acquire --file "custom.lock"
  [ "$status" -eq 0 ]
  [ -f "custom.lock" ]
  [ ! -f ".autopilot.lock" ]
}

@test "custom stale minutes works" {
  # Lock created 10 minutes ago, with 5-minute stale timeout
  local old_time=$(( $(date +%s) - 600 ))
  printf '%s\nold-session\n' "$old_time" > .autopilot.lock

  run bash "$SCRIPTS_DIR/lock.sh" acquire --stale-minutes 5
  [ "$status" -eq 0 ]
  [[ "$output" == ACQUIRED_STALE:* ]]
}

@test "missing action fails" {
  run bash "$SCRIPTS_DIR/lock.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"action required"* ]]
}

@test "lock file contains epoch and uuid" {
  bash "$SCRIPTS_DIR/lock.sh" acquire >/dev/null
  local line_count=$(wc -l < .autopilot.lock | tr -d ' ')
  [ "$line_count" -eq 2 ]
  # First line should be a number (epoch)
  local first_line=$(head -1 .autopilot.lock)
  [[ "$first_line" =~ ^[0-9]+$ ]]
}

@test "help flag shows usage" {
  run bash "$SCRIPTS_DIR/lock.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
