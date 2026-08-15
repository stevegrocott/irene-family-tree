#!/bin/bash
# Platform configuration for this project
# Modified by /adapting-claude-pipeline during setup

# Issue tracker
TRACKER="${TRACKER:-github}"              # github | jira
TRACKER_CLI="${TRACKER_CLI:-gh}"          # gh | acli
JIRA_PROJECT="${JIRA_PROJECT:-}"          # Jira project key (e.g., KIN) — only used when TRACKER=jira
JIRA_DEFAULT_ISSUE_TYPE="${JIRA_DEFAULT_ISSUE_TYPE:-Task}"
JIRA_DONE_TRANSITION="${JIRA_DONE_TRANSITION:-Done}"
JIRA_IN_PROGRESS_TRANSITION="${JIRA_IN_PROGRESS_TRANSITION:-In Progress}"

# Git host
GIT_HOST="${GIT_HOST:-github}"            # github | gitlab
GIT_CLI="${GIT_CLI:-gh}"                  # gh | glab

# Merge strategy
MERGE_STYLE="${MERGE_STYLE:-squash}"      # squash | merge | rebase
# AUTO_MERGE: set to 1 to automatically merge the PR after all checks pass.
# Set to 0 to leave the PR open for manual review and merging.
# MERGE_STYLE (above) controls the merge method used when AUTO_MERGE=1.
AUTO_MERGE="${AUTO_MERGE:-0}"             # 0 = manual merge | 1 = auto-merge when checks pass

# Test commands (set during /adapt based on project stack)
TEST_UNIT_CMD="${TEST_UNIT_CMD:-npm test}"        # e.g., "npm test", "vendor/bin/phpunit", "pytest"
TEST_E2E_CMD="${TEST_E2E_CMD:-npx playwright test}"          # e.g., "npx playwright test" — empty if no E2E
TEST_E2E_BASE_URL="${TEST_E2E_BASE_URL:-http://localhost:3000}"
# TDD reordering for E2E: default true when TEST_E2E_CMD is set; set false to keep smoke tests only without TDD reordering
if [[ -z "${E2E_TDD_ENABLED:-}" ]]; then
  [[ -n "${TEST_E2E_CMD:-}" ]] && E2E_TDD_ENABLED=true || E2E_TDD_ENABLED=false
fi

# Frontend path patterns — pipe-separated globs used by _matches_frontend_pattern()
# to decide whether a branch touches frontend code (gates E2E verification)
# e.g., "src/components/*|src/pages/*|tests/e2e/*"
#
# Left empty, `_matches_frontend_pattern` returns non-zero for every file, so
# `detect_change_scope` can never return `frontend`/`ts-frontend` and the
# `e2e_verify` stage is unreachable for any change (issue #255). It also drives
# frontend-vs-backend agent routing in issue-body-lib.sh and
# create-followup-issue.sh, which silently defaulted everything to backend.
#
# Note `*` matches `/` in bash `case` patterns, so each entry covers any depth.
FRONTEND_PATH_PATTERNS="${FRONTEND_PATH_PATTERNS:-src/app/*|src/components/*|src/styles/*|tests/e2e/*|*.css}"

# Container rebuild before E2E. The pipeline's origin project runs frontend and
# backend as docker-compose services and rebuilds them so E2E hits fresh code.
# This project has no compose file — Playwright's own `webServer` starts and
# reuses `npm run dev` on TEST_E2E_BASE_URL — so the rebuild always failed and
# took E2E down with it ("Container rebuild/health failed — skipping E2E").
# Defaults to true so compose-based consumers are unaffected (issue #255).
#
# !! DEPENDS ON AN UPSTREAM CHANGE. This flag only has an effect if
# .claude/scripts/implement-issue-orchestrator.sh gates rebuild_and_health_check
# on it, at BOTH call sites (the test loop and the e2e_verify stage). That gate
# is a local edit to a shared core file, pending upstream. `pipeline-sync to`
# WILL revert it and silently take E2E down again — this line will still be here
# and will simply stop doing anything.
#
# To check the gate is still present:
#   grep -c E2E_CONTAINER_REBUILD .claude/scripts/implement-issue-orchestrator.sh
#   # expect 6; 0 means the gate was reverted by a pipeline pull
#
# The symptom to watch for in a run log:
#   "Container rebuild/health failed (health: ) — skipping E2E in test loop"
E2E_CONTAINER_REBUILD="${E2E_CONTAINER_REBUILD:-false}"

# !! SAME TRAP AS ABOVE (issue #310). The e2e_verify stage got a third result
# state, `inconclusive`, so an unfinished run no longer gets misreported as
# `failed` and routed into fix-e2e. That's two local edits to shared pipeline
# files, gitignored here same as this one, and a `pipeline-sync` pull WILL
# revert both:
#   - .claude/scripts/schemas/implement-issue-e2e-validate.json — result enum
#     must include "inconclusive"
#   - .claude/scripts/implement-issue-orchestrator.sh — the e2e-verify stage
#     prompt (~L8600-8629) must instruct the suite to run in the FOREGROUND
#     to completion, and MAX_TURNS_E2E_VERIFY (default 20, ~L2847) must stay
#     raised above the old 10-turn "light stage" cap
#
# To check both are still present:
#   grep -c inconclusive .claude/scripts/schemas/implement-issue-e2e-validate.json
#   # expect >=1; 0 means the enum value was reverted by a pipeline pull
#   grep -c MAX_TURNS_E2E_VERIFY .claude/scripts/implement-issue-orchestrator.sh
#   # expect >=1; 0 means the raised turn budget was reverted
#
# The symptom to watch for: a passing (but unfinished) e2e_verify run reported
# as `failed` and escalated into a fix-e2e iteration that edits production code.

# Deploy verification (configure during /adapt if project has a test environment)
# Set DEPLOY_VERIFY_CMD to a shell command that triggers a deploy to the target
# environment (e.g., "./scripts/deploy-test.sh").  Leave empty to skip the stage.
# Set DEPLOY_VERIFY_HEALTH_URL to the health-check endpoint of that environment;
# the orchestrator polls it at 10 s intervals for up to 15 min (90 retries).
DEPLOY_VERIFY_CMD="${DEPLOY_VERIFY_CMD:-}"
DEPLOY_VERIFY_HEALTH_URL="${DEPLOY_VERIFY_HEALTH_URL:-}"
DEPLOY_VERIFY_TIMEOUT_SECS="${DEPLOY_VERIFY_TIMEOUT_SECS:-900}"  # Max seconds to poll health URL (default 15 min)

# Claude CLI (resolve path for non-interactive shells where aliases aren't available)
if [[ -z "${CLAUDE_CLI:-}" ]]; then
  if [[ -x "$HOME/.claude/local/claude" ]]; then
    CLAUDE_CLI="$HOME/.claude/local/claude"
  else
    CLAUDE_CLI="claude"
  fi
fi

# Lint and format (set during /adapt)
LINT_CMD="${LINT_CMD:-}"
FORMAT_CMD="${FORMAT_CMD:-}"

# Project context file — project teams write their patterns, conventions, and
# architecture notes here so that agents have consistent codebase context.
# The orchestrator injects this file into agent prompts when it exists.
PLATFORM_CONTEXT_FILE="${PLATFORM_CONTEXT_FILE:-.claude/config/context.md}"

# Orchestrator iteration limits (override defaults from implement-issue-orchestrator.sh)
MAX_QUALITY_ITERATIONS="${MAX_QUALITY_ITERATIONS:-5}"
MAX_TEST_ITERATIONS="${MAX_TEST_ITERATIONS:-7}"
MAX_PR_REVIEW_ITERATIONS="${MAX_PR_REVIEW_ITERATIONS:-2}"
MAX_VALIDATION_FIX_ITERATIONS="${MAX_VALIDATION_FIX_ITERATIONS:-2}"
MAX_E2E_FIX_ITERATIONS="${MAX_E2E_FIX_ITERATIONS:-2}"
MAX_ORCHESTRATOR_WALL_TIME="${MAX_ORCHESTRATOR_WALL_TIME:-10800}" # seconds (default 3 hours — long-running issues with many tasks or slow test suites can easily exceed 1 hour)
MAX_TASK_WALL_TIME_SECS="${MAX_TASK_WALL_TIME_SECS:-900}"        # seconds per parallel task (default 15 min)
