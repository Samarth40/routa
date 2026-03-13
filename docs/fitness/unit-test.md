# Rust Unit-Test Fitness Snapshot

> Use with `docs/fitness/README.md`. Keep this file concise and state-focused.

## Scope

- `crates/routa-core/src`
- `crates/routa-server/src`

## Key Metrics

- Baseline (2026-03-13): `13 / 120 = 10.8%` files with tests
- Current: `15 / 120 = 12.5%` files with tests
- Delta: `+2` files (`+1.7pp`)
- Primary metric target: `cargo llvm-cov` line coverage
- Proxy metric (temporary): file-level test ratio

## Targets

- `routa-core` line coverage >= 55% (short-term), >= 70% (mid-term)
- touched crate/module coverage: no regression per PR
- new/changed Rust store and API logic: include direct unit tests in same PR

## Current Status

- Phase 1 (core pure logic): done
- Phase 2 (store layer): done
- Phase 3 (server helper logic): in progress
- Phase 4 (coverage ratchet in CI): pending

## This PR Coverage Contributions

- `routa-core/src/git.rs`
- `routa-core/src/store/workspace_store.rs`
- `routa-core/src/store/codebase_store.rs`
- `routa-server/src/api/files.rs`
- `routa-server/src/api/clone.rs`

## Known Blockers

- `cargo llvm-cov` not installed in current environment
- full `cargo test -p routa-core --offline` has existing sandbox permission noise in `local_session_provider` tests

## Next Batch

- Continue Phase 3 on API pure-function modules (`tasks.rs` mappers/sanitizers, similar deterministic helpers)
- Enable `cargo llvm-cov` in CI and switch primary tracking from proxy metric to line coverage trend
