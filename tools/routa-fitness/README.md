# routa-fitness

`routa-fitness` is a Python CLI and library for running architecture fitness checks.

It started inside Routa, but the package is being shaped as a reusable fitness engine:

- run shell-based quality gates
- group checks by architectural dimension
- support fast/normal/deep execution tiers
- run change-aware checks for the current git diff
- detect risky changes that should trigger human review

## Install

```bash
pip install routa-fitness
```

For local development inside this repository:

```bash
pip install -e tools/routa-fitness
```

## CLI

```bash
routa-fitness run --tier fast
routa-fitness run --changed-only --base HEAD~1
routa-fitness validate
routa-fitness review-trigger --base HEAD~1
```

## Expected Project Layout

By default, `routa-fitness run` looks for fitness specs under:

```text
docs/fitness/*.md
```

Each spec file uses YAML frontmatter to declare executable metrics.

Minimal example:

```yaml
---
dimension: code_quality
weight: 20
threshold:
  pass: 90
  warn: 80
metrics:
  - name: lint
    command: npm run lint 2>&1
    hard_gate: true
    tier: fast
---
```

`review-trigger` uses a YAML config file, by default:

```text
docs/fitness/review-triggers.yaml
```

Minimal example:

```yaml
review_triggers:
  - name: high_risk_directory_change
    type: changed_paths
    paths:
      - src/core/acp/**
    severity: high
    action: require_human_review
```

## Python API

```python
from pathlib import Path

from routa_fitness.review_trigger import (
    collect_changed_files,
    collect_diff_stats,
    evaluate_review_triggers,
    load_review_triggers,
)

repo_root = Path(".").resolve()
rules = load_review_triggers(repo_root / "docs" / "fitness" / "review-triggers.yaml")
changed_files = collect_changed_files(repo_root, "HEAD~1")
diff_stats = collect_diff_stats(repo_root, "HEAD~1")
report = evaluate_review_triggers(rules, changed_files, diff_stats, base="HEAD~1")
print(report.to_dict())
```

## Status

Current package status:

- stable for Routa-internal usage
- usable as a standalone CLI for markdown-frontmatter fitness specs
- still evolving toward a more reusable core/adapter/preset architecture
