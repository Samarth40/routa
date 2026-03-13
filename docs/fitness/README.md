# Architecture Fitness (Rust Testing)

## Goal

Use a measurable fitness function to guard Rust quality in AI-driven high-frequency changes:

- hard gates (must pass)
- score/radar metrics (must trend better)
- ratchet policy (no regression on touched areas)

This follows the direction discussed in issue `#139`.

## Required Execution Flow

1. Read `AGENTS.md`.
2. Use this file as the policy baseline.
3. Update only key state in `docs/fitness/unit-test.md` (no step-by-step logs).

## Hard Gates (PR)

- Rust tests for changed modules must pass.
- `cargo clippy --all-targets -- -D warnings` must pass.
- Coverage on touched crate/module must not regress.
- If line coverage cannot be collected, fallback proxy metric must not regress.

## Score Metrics (Trend)

- Primary: line/function coverage (`cargo llvm-cov`).
- Secondary proxy: files-with-tests ratio.
- Optional: module risk weighting (store/api/core utility).

## Coverage Tooling

Install once:

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov
```

Run:

```bash
npm run rust:cov
npm run rust:cov:lcov
npm run rust:cov:html
```

Direct script usage:

```bash
./scripts/rust-coverage.sh routa-core summary
./scripts/rust-coverage.sh routa-core lcov
./scripts/rust-coverage.sh routa-core html
```

## CI Artifacts

- coverage summary (stdout)
- `target/coverage/*.lcov` (if generated)
- `unit-test.md` key snapshot update (baseline/current/delta)

## Update Rules For `unit-test.md`

Keep only:

- baseline and current metrics
- target thresholds
- current phase status
- top priorities / next batch
- known blockers

Do not keep:

- command-by-command execution history
- repeated transient logs
