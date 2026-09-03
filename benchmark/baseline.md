# Agent Benchmark — Baseline

| | |
|---|---|
| **Model** | `qwen2.5` |
| **Recorded** | 2026-09-04 |
| **Task set** | `7d533a54` |
| **Repetitions** | ×5 |
| **Deployment** | Docker Compose (`bot-net`) |

## Summary

| Executions | Correctness | Tokens / pass | Turns / pass |
|---|---|---|---|
| 30 (6 tasks × 5 reps) | **100%** (30/30) | **10,065** (6 tasks) | 14 (25 tool calls) |

## Per-task reading

Every task ran 5 times under fixed sampling (temperature `0`, seed `42`). Figures below are the steady-state per-execution values — identical across repetitions except where noted.

| Task | Kind | Tokens | Turns | Tool calls | Correct |
|---|---|---:|---:|---:|---:|
| `capital-of-france` | no-tools | 709 | 1 | 0 | 5 / 5 |
| `shell-arithmetic` | command | 1,609 * | 2 | 1 | 5 / 5 |
| `read-os-release` | file-read | 1,583 | 2 | 1 | 5 / 5 |
| `word-count-skill` | skill | 1,694 | 2 | 2 | 5 / 5 |
| `subagent-three-sums` | subagent | 2,974 | 5 | 1 | 5 / 5 |
| `remember-favorite-number` | multi-turn | 1,496 | 2 | 0 | 5 / 5 |

\* First repetition measured 1,588 tokens (21 fewer) in both independent runs of this baseline — a one-time effect, not noise. See Reproducibility below.

## Reproducibility

This baseline was recorded twice, independently, over two different transports — once attached to the Compose network by hand, once via `docker compose run` — to confirm the numbers above are the run's, not the plumbing's.

**Result:** both runs produced identical per-task token counts, turns and tool-call counts across all 5 repetitions, with the single noted exception — the same one, in both runs. No task in the set answered inconsistently, so none needed fixing or removing before freezing the baseline.

Deterministic sampling narrows variance; it doesn't guarantee it, which is why every task still runs multiple times and correctness is judged over repetitions rather than a single sample.

## Reading the numbers

**Cost.** No `prices.json` is configured in this environment, so every call is recorded as unpriced (estimated cost `$0`) rather than measured against a real rate. Tokens are the load-bearing metric here; add a price table to also track a proxy dollar figure.

**Sub-agent accounting.** `subagent-three-sums`'s 2,974 tokens and 5 turns already include its three concurrent sub-agent calls (1 top-level turn to decide + 1 to reply + 3 sub-agent turns) — sub-agent activity is attributed to the same execution, not counted separately.

## Using this baseline

This is the reference point for the token-optimization work: run the benchmark again afterward under a new label, then diff the two.

```bash
# after the optimization change lands
npm run benchmark:docker:run -- after-optimization
docker compose run --rm benchmark node --import tsx benchmark/compare-cli.ts baseline after-optimization
```

The comparison refuses to run if the model or task set differs between the two snapshots, and calls out any task whose correctness rate drops individually rather than only moving the overall average.

**One thing to hold onto:** `data/benchmark-snapshots/baseline.json` is local and gitignored, like the rest of `data/` — it only exists on this machine. Keep it (or re-run this baseline) before comparing from anywhere else.

---
*telegram-agent · `benchmark/tasks.ts` @ `7d533a54` · source: `data/benchmark-snapshots/baseline.json`*
