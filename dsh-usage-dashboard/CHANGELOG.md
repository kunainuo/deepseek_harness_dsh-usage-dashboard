# Changelog

All notable changes to this project are documented in this file.

## [1.0.0] - 2026

### Added

- Persistent DSH composition plugin (survives DSH restarts; no re-approval).
- DeepSeek API balance: total / topped-up / granted / availability / currency (60 s cache).
- Token usage statistics from local DSH session logs:
  - cumulative input / output / total tokens, model-call count, session count;
  - last-14-days stacked bar chart (input + output);
  - per-model bar chart;
  - top-5 sessions table.
- Floating card (bottom-right, always on top) with compact ↔ expanded modes.
- Sidebar footer "Usage" button (📊 in rail mode).
- Auto-refresh (default 60 s; 30 s / 1 min / 5 min / off) with anti-overlap guarding.
- Fast raw-log scan via `sessionPersistence.readRaw` (zstd frames, no replay validation; validated-read fallback).
- Install / uninstall PowerShell scripts with idempotent composition patching and legacy-name migration.
- Bilingual README (English / 简体中文) and MIT license.

[1.0.0]: https://github.com/kunainuo/deepseek_harness_dsh-usage-dashboard