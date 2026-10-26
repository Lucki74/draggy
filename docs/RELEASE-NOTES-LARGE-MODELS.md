# Large models release notes

## Overview

Draggy can run MoE models larger than your RAM and VRAM combined by spreading them across VRAM, RAM and the drive. See [large-models.md](large-models.md).

## What is new

- **Large models panel** in Settings → Models: three-tier bar, speed range, plain-language plan, disk measurement and resumable downloads with progress.
- **colibri engine** managed by Draggy as a second engine beside llama.cpp, with hash-verified downloads. On Windows it gets a Draggy-owned Python runtime; elsewhere it uses the system `python3`.
- **llama.cpp expert streaming**: used automatically when the installed build supports the `--moe-stream-*` flags.
- **Slow mode** under 3 tokens per second: capped tool rounds, thinking off by default (setting: slow-model thinking), and a notification for long turns in an unfocused window.
- **Measured speeds** replace estimates after three replies; the expert hot set is backed up outside the model folder.
- **Experimental routing switch** (lossy cache routing) for colibri, off by default.
- **Load phases and live tiers**: the panel names the load step (engine, dense layers, experts) and shows live VRAM/RAM/drive expert counts while serving.
- **Slow-model care**: a notice before agentic coding on a slow model, and no automatic compaction on one.
- **Diagnostics report** for large models, with no prompts or replies.

## Known limits

- Letter-to-disk mapping works on single-internal-disk machines only; otherwise the benchmark is cached per volume.
- Some catalog sizes are estimates until measured.
- Not included yet: the model converter, `coli tune` as an in-app job, per-chat KV persistence (colibri documents it only for GLM-5.2) and a time-to-finish estimate.
- Speeds have not yet been measured on real hardware.
