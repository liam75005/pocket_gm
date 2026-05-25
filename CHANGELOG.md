# Changelog

## [1.0.0] — 2026-05-25

First production release. Migrates from internal prototype `v8` numbering to semantic versioning.

### Highlights

- Solo D&D 2024 game engine with strict rule enforcement
- Hommlet test scenario (3 acts) with companion recruitment, skill-based obstacle, balanced combat encounter
- 4 pre-built characters covering Fighter, Cleric, Rogue, Wizard
- ASCII battle map with auto-update after each movement
- Initiative tracker with manual turn advancement for NPCs
- Death saves integrated into combat flow (1 roll per turn)
- Companion downed/stabilized states distinct from death
- Game over only triggers on player death
- Reactions during enemy turns (Shield, opportunity attacks)
- Surprise = disadvantage on initiative (2024 rule)
- Strict tracking of action economy, spell slots, limited resources
- Mobile-first UI with combat drawer keeping chat full-screen
- 3 manual save slots + auto-save (survives orientation changes)
- Token counter with per-model pricing and cache savings display
- Model selector (Sonnet 4.6 / Haiku 4.5)
- Prompt caching via `cache_control: ephemeral`
- Cloudflare Workers backend proxy template for public deployment
- API error recovery (500/502/503/429) preserves history integrity
- Content refusal detection with auto-progression hint

### Stack

- Single HTML file (~145 KB), no build, no dependencies
- Vanilla JS ES5, CSS3, HTML5
- Anthropic Messages API direct
- localStorage (browser) or window.storage (Claude.ai artifact)
