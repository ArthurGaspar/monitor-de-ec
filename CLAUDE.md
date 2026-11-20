# CLAUDE.md

Guidance for Claude Code in this repository. The README (Portuguese) explains the method; this file is the short version.

## What this is

A Python ETL over Brazilian open data: CVM DFP/ITR filings (2019 onward), the CVM company register and Tesouro Direto
rates. It writes a DuckDB file and a small JSON snapshot that a static Vite + TypeScript + ECharts dashboard reads. An LLM
(Claude, or Ollama locally) writes a quarterly bulletin from a precomputed fact sheet, and the bulletin's numbers and
terms are checked against that sheet.

```
extract (cached zips) -> cvm.read_zip -> quality.fix_scale -> quarters.standalone_quarters -> metrics -> pipeline.publish
                                                                                                      -> web/public/data/*.json
bulletin.generate reads that JSON -> fact sheet -> LLM -> check()/check_terms() -> boletins.json
```

## Commands

```sh
uv sync
uv run python -m etl run [--offline]       # --offline reuses .data/raw (~20 s)
uv run python -m etl bulletin [--provider auto|anthropic|ollama] [--quarters N]
uv run pytest -q
cd web && npm ci && npm run build          # tsc --noEmit + vite build; npm run dev for local
```

## Invariants

- **Fix scale before deriving quarters.** Q4 = DFP annual − ITR 9M YTD; a mis-scaled filing on either side corrupts it.
  `quality.fix_scale` works on facts per filing (cd_cvm, source, dt_refer), not on quarters.
- **Growth is same-company.** Never compute growth from sector totals; use `metrics._growth`.
- **Financial sector has no revenue, margin or debt.** `company_panel` nulls them; keep it that way.
- **JSON contracts are mirrored in `web/src/data.ts`.** Changing what `pipeline.publish` or `bulletin.generate` writes
  means updating those interfaces.
- **Don't run local LLM inference unasked.** `etl bulletin --provider ollama` loads ~5.5 GB and pins the CPU for minutes
  on the dev machine; run it alone, in the foreground, and `ollama stop qwen2.5:7b` afterwards.
- Generated and cached data stays out of git (`.data/`, `web/dist/`, `web/node_modules/`); `web/public/data/` is the
  versioned snapshot the Pages build uses.

## Style

- Python: modules open with a narrative docstring explaining *why*; sparse comments; long lines (~130) fine; tuning
  constants are module-level UPPER_CASE with a comment. User-facing text and docstrings are in Portuguese.
- TypeScript is strict with no unused locals/params; colors come only from CSS tokens in `style.css` (light and dark).
- Copy is plain and honest about limits; don't overstate results.
