# Pocket GM

> A solo Dungeon Master for D&D 2024, powered by Claude.

Pocket GM turns the Anthropic API into a complete tabletop RPG referee. It runs a full adventure with narrative, tactical combat (ASCII battle map + initiative tracker), strict D&D 2024 rules enforcement (action economy, spell slots, opportunity attacks, surprise, death saves), companion NPCs, multi-slot saves, prompt caching, and supports both Sonnet and Haiku models.

Built as a single self-contained HTML file. No build step, no framework, no dependencies. Deploy by uploading one file.

## Quick start

### Option A — Run locally (your own API key)

1. Open `index.html` in Chrome.
2. The app asks for an Anthropic API key (`sk-ant-...`) — get one at [console.anthropic.com](https://console.anthropic.com).
3. The key is stored in your browser's `localStorage`, never sent anywhere except `api.anthropic.com`.

### Option B — Deploy publicly (shared key, via proxy)

1. Deploy the Cloudflare Worker in [`backend/`](./backend/) (see [`backend/README.md`](./backend/README.md)).
2. Update the `fetch()` URL in `index.html` to point at your Worker.
3. Push `index.html` to GitHub Pages or any static host.

### Option C — Run as a Claude.ai artifact

The HTML detects `window.storage` and routes persistence through it automatically. Just paste the file into an artifact.

## What's included

### Test scenario: Hommlet (Greyhawk, level 1)

Three-act adventure to exercise every game system:
- **Act 1** — Recruit a companion NPC at the Welcome Wench inn. Companion is chosen to complement the player's class (caster for fighter, tank for mage, etc.).
- **Act 2** — A ravine blocks the road. Three approaches: jump (Athletics DC 13), find a way around (Survival DC 12), build a bridge (Investigation DC 14).
- **Act 3** — Bandit ambush with a 10x10 ASCII battle map. Three enemies balanced for a level-1 party of two. Persuasion DC 15 or Intimidation DC 13 to avoid the fight.

### Four pre-built characters (D&D 2024 SRD 5.2)

- **Aldric Forgebraise** — Human Fighter, Soldier background
- **Sister Mira** — Halfling Cleric, Acolyte background
- **Corvin the Shadow** — Half-Elf Rogue, Criminal background
- **Elysa Windborn** — High-Elf Wizard, Sage background

Each character has full 2024 stat blocks with weapon mastery properties (Sap, Slow, Vex, Topple, Nick), proper background feats, and spell lists.

### Game systems implemented

| System | Implementation |
|---|---|
| Initiative | Rolled client-side, ties favor enemies |
| Surprise (2024) | Disadvantage on initiative, no surprise round |
| Action economy | 1 action + 1 bonus action + 1 reaction + move, strictly enforced |
| Spell slots | Counted per-level, refused if depleted |
| Limited resources | Second Wind, Arcane Recovery, Sneak Attack tracked in notes |
| Opportunity attacks | Triggered automatically when adjacent enemies leave reach |
| Reactions | Player can react during enemy turns (Shield, OA, etc.) |
| Death saves | One roll per player turn in initiative, not a frantic chain |
| Companion downed/stabilized | Death of companion does NOT trigger game over |
| Battle map | ASCII grid updated after every movement |
| Weapon swap | 2024 rules: free with attack action |
| Equipment & gold | Strict tracking via `STATE` JSON updates |

### Quality-of-life features

- **3 manual save slots** + **1 auto-save** that survives orientation changes on mobile
- **Token counter** in the header with per-call cost breakdown and cache savings
- **Model picker** (Sonnet 4.6 / Haiku 4.5) with per-model pricing
- **Prompt caching** via Anthropic's `cache_control: ephemeral` — ~80% reduction on repeated calls
- **Mobile drawer** for combat tracker and map (chat stays full-screen)
- **Abandon button** to recover from stuck states
- **API error recovery** — 500/502/503/429 errors auto-restore history integrity
- **Refusal detection** — if the model refuses an in-character action, the player gets a hint and combat auto-progresses

## Architecture

### Stack

- Pure HTML / CSS / JavaScript ES5, no dependencies
- `fetch()` to `api.anthropic.com/v1/messages` (or proxy)
- `localStorage` (browser) or `window.storage` (Claude.ai artifact)
- ~145 KB single file, ~2600 lines

### System prompt structure

About 17,500 characters / 4,400 tokens, split for caching at a `===CACHE_BOUNDARY===` marker:

- **Static prefix (cached)** — scenario data, all D&D 2024 rule sections, JSON protocol spec
- **Dynamic suffix** — current character state (HP, spell slots, inventory, gold, conditions, combat status, session notes)

### JSON protocol

The DM responds with narrative text interspersed with structured JSON blocks parsed by a custom balanced-brace extractor.

| Block | Purpose |
|---|---|
| `{"ROLL":...}` | Request a dice roll from the player |
| `{"COMBAT":{"start":true,...}}` | Initialize combat with initiative + battle map |
| `{"COMBAT":{"kill":"..."}}` | Mark enemy dead |
| `{"COMBAT":{"downed":"..."}}` | Companion at 0 HP, dying |
| `{"COMBAT":{"stabilized":"..."}}` | Companion no longer dying |
| `{"COMBAT":{"revive":"..."}}` | Healed back above 0 HP |
| `{"COMBAT":{"mapUpdate":"...","legend":"..."}}` | Refresh battle map |
| `{"COMBAT":{"end":true}}` | Combat ended |
| `{"TURN":"next"}` | Advance initiative order |
| `{"REACTION":{"prompt":"..."}}` | Offer the player a reaction during an enemy turn |
| `{"STATE":{...}}` | Update HP, inventory, gold, spell slots, conditions, notes |

### Storage keys

| Key | Contents |
|---|---|
| `n1v8_1`, `n1v8_2`, `n1v8_3` | Manual save slots |
| `n1v8_autosave` | Auto-save (cleared on game over) |
| `n1v8_key` | Anthropic API key (local mode only) |
| `n1v8_model` | "sonnet" or "haiku" |

## Tested scenarios

- Full adventure playthroughs on desktop and mobile (Chrome, Safari)
- Companion death -> combat continues without game over
- Player downed -> death saves spread across combat rounds
- Reactions during enemy turns
- Orientation changes (mobile) restore mid-combat state
- Save / load preserves combat state including battle map
- Rate limit (429) and server error (500) recovery without history corruption

## Known limitations

- ASCII battle map (no image generation)
- One DM model per game (can switch between adventures)
- French scenario, but the engine is language-agnostic
- Single-player only (no multiplayer)
- Death is permanent (intentional)

## Contributing

Bug reports and feedback welcome via GitHub Issues. PRs accepted for:

- New scenarios (drop them in a `scenarios/` folder)
- New pre-built characters
- Bug fixes in combat / rules enforcement
- UI improvements for mobile

## License

[MIT](./LICENSE)

## Credits

Built iteratively with Claude as both architect and pair programmer. The character creation, D&D 2024 rule interpretation, and combat protocol design all emerged from a long test-driven conversation.
