#!/usr/bin/env bats
#
# Guards the two config values that made `e2e_verify` unreachable (issue #255).
#
# `detect_change_scope` only returns `frontend`/`ts-frontend` when
# `_matches_frontend_pattern` matches at least one changed file, and that
# helper returns non-zero for *everything* when FRONTEND_PATH_PATTERNS is
# empty. With the pattern list empty, every `.ts`/`.tsx` change classified as
# `typescript`, the `e2e_verify` guard rejected it, and no E2E stage could run
# for any change in this repo. These tests fail if the list is emptied again.
#
# The two functions are extracted from implement-issue-orchestrator.sh rather
# than sourced: that script executes work at load time, so sourcing it in a
# test would run the pipeline.

setup() {
    REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
    ORCH="${REPO_ROOT}/.claude/scripts/implement-issue-orchestrator.sh"
    PLATFORM="${REPO_ROOT}/.claude/config/platform.sh"

    # Extract just the two functions under test into a sourceable file.
    EXTRACT="${BATS_TEST_TMPDIR}/scope-fns.sh"
    awk '/^_matches_frontend_pattern\(\)/,/^}/' "$ORCH"  > "$EXTRACT"
    awk '/^detect_change_scope\(\)/,/^}/'      "$ORCH" >> "$EXTRACT"

    # Stubs for the logging the extracted function calls.
    { echo 'log_warn() { :; }'; echo 'log() { :; }'; } >> "$EXTRACT"

    # shellcheck disable=SC1090
    source "$EXTRACT"

    # Extract the e2e_verify -> fix-e2e dispatch gate (issue #310). It's
    # inline in a large function rather than its own top-level function, so
    # it can't be pulled out by awk function-range like the two above.
    # Instead, grab the exact `if [[ ... ]]; then` line and wrap its `[[ ]]`
    # test verbatim as a function body — no eval, no reimplemented logic.
    GATE_EXTRACT="${BATS_TEST_TMPDIR}/e2e-fix-gate.sh"
    local gate_line
    gate_line=$(grep \
        '^[[:space:]]*if \[\[ "\$e2e_verify_status" == "failed" \]\]; then$' \
        "$ORCH")
    if [[ -n "$gate_line" ]]; then
        gate_line="${gate_line#*if }"
        gate_line="${gate_line%; then}"
        {
            printf '_e2e_fix_gate_fires() {\n'
            printf '    local e2e_verify_status="$1"\n'
            printf '    %s\n' "$gate_line"
            printf '}\n'
        } > "$GATE_EXTRACT"
        # shellcheck disable=SC1090
        source "$GATE_EXTRACT"
    fi
}

# ── FRONTEND_PATH_PATTERNS is configured ────────────────────────────────────

@test "platform.sh sets a non-empty FRONTEND_PATH_PATTERNS" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    [ -n "$FRONTEND_PATH_PATTERNS" ]
}

@test "platform.sh opts this project out of the container rebuild" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    [ "$E2E_CONTAINER_REBUILD" = "false" ]
}

# ── _matches_frontend_pattern ───────────────────────────────────────────────

@test "component files match the configured frontend patterns" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    run _matches_frontend_pattern "src/components/PersonNode.tsx"
    [ "$status" -eq 0 ]
}

@test "e2e specs match the configured frontend patterns" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    run _matches_frontend_pattern "tests/e2e/drawer-crud.spec.ts"
    [ "$status" -eq 0 ]
}

@test "api routes do NOT match — backend-only work must not be dragged through E2E" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    run _matches_frontend_pattern "src/lib/neo4j.ts"
    [ "$status" -ne 0 ]
}

@test "an empty pattern list matches nothing — the #255 regression" {
    FRONTEND_PATH_PATTERNS=""
    run _matches_frontend_pattern "src/components/PersonNode.tsx"
    [ "$status" -ne 0 ]
}

# ── detect_change_scope ─────────────────────────────────────────────────────
#
# Builds a throwaway git repo per test so the three-dot diff has real history.

_make_repo() {
    cd "$BATS_TEST_TMPDIR" || return 1
    rm -rf scoperepo && mkdir scoperepo && cd scoperepo || return 1
    git init -q -b main
    git config user.email t@t.t && git config user.name t
    mkdir -p src/components src/lib tests/e2e
    echo base > README.md
    git add -A && git commit -qm base
    git checkout -q -b feature
}

@test "a component change classifies as ts-frontend, so e2e_verify runs" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    _make_repo
    echo 'export const x = 1' > src/components/Thing.tsx
    git add -A && git commit -qm feat
    run detect_change_scope "$PWD" main
    [ "$output" = "ts-frontend" ]
}

@test "an e2e spec change classifies as ts-frontend" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    _make_repo
    echo 'test("x", () => {})' > tests/e2e/thing.spec.ts
    git add -A && git commit -qm test
    run detect_change_scope "$PWD" main
    [ "$output" = "ts-frontend" ]
}

@test "a backend-only change still classifies as typescript, not ts-frontend" {
    # shellcheck disable=SC1090
    source "$PLATFORM"
    _make_repo
    echo 'export const q = 1' > src/lib/query.ts
    git add -A && git commit -qm backend
    run detect_change_scope "$PWD" main
    [ "$output" = "typescript" ]
}

@test "with an empty pattern list a component change degrades to typescript — the #255 regression" {
    FRONTEND_PATH_PATTERNS=""
    _make_repo
    echo 'export const x = 1' > src/components/Thing.tsx
    git add -A && git commit -qm feat
    run detect_change_scope "$PWD" main
    [ "$output" = "typescript" ]
}

# ── e2e_verify → fix-e2e dispatch gate ──────────────────────────────────────
#
# On issue #284 an unfinished e2e_verify run was reported as `failed` and
# escalated into a 19-minute fix-e2e iteration that committed production
# changes for a bug that did not exist (issue #310). The dispatch gate below
# is what decides whether `fix-e2e-iter-N` ever runs: it only writes
# $e2e_fail_file (and only that write lets the fix-e2e loop start) when
# e2e_verify_status is the exact string "failed". These tests pin that gate
# so a future third result state — "inconclusive" — can never be routed into
# fix-e2e, and so a refactor to something looser (e.g. `!= "passed"`) can't
# reintroduce the same failure mode.

@test "the e2e_verify fix-e2e dispatch gate is present exactly once" {
    run grep -c \
        '^[[:space:]]*if \[\[ "\$e2e_verify_status" == "failed" \]\]; then$' \
        "$ORCH"
    [ "$status" -eq 0 ]
    [ "$output" -eq 1 ]
}

@test "a failed e2e_verify result fires the fix-e2e dispatch gate" {
    run _e2e_fix_gate_fires "failed"
    [ "$status" -eq 0 ]
}

@test "an inconclusive e2e_verify result never fires the fix-e2e dispatch gate" {
    run _e2e_fix_gate_fires "inconclusive"
    [ "$status" -ne 0 ]
}

@test "a passed e2e_verify result never fires the fix-e2e dispatch gate" {
    run _e2e_fix_gate_fires "passed"
    [ "$status" -ne 0 ]
}
