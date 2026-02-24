# Copilot Plugin Suite for OpenRCT2

Four OpenRCT2 plugins powered by the [GitHub Copilot SDK](https://github.com/github/copilot-sdk/tree/main/nodejs). Each plugin is a single ECMAScript 5 file written to the [OpenRCT2 scripting guide](../../distribution/scripting.md#writing-scripts): one `registerPlugin()` call, no `import`/`require`, no ES6+ syntax, Duktape-compatible.

All four plugins talk to a shared Node.js companion server over a local TCP socket — the only networking primitive available to OpenRCT2 scripts (see [scripting.md §communication](../../distribution/scripting.md#can-plugins-communicate-with-other-processes-or-the-internet)).

```
OpenRCT2 game
  ├─ plugin.js          ─┐
  ├─ ride-namer.js       ├─(TCP localhost:9001)─► server.mjs ─► @github/copilot-sdk
  ├─ guest-mood.js       │                                          └─ Copilot / BYOK
  └─ scenario-coach.js  ─┘
```

---

## The four plugins

| File | Menu item | What it does |
|------|-----------|--------------|
| `plugin.js` | **Copilot Park Advisor** | Reads park stats and asks Copilot for 3 management recommendations |
| `ride-namer.js` | **Copilot Ride Namer** | Suggests 5 creative names for any ride; applies the chosen one via the `ridesetname` game action |
| `guest-mood.js` | **Copilot Guest Mood** | Samples up to 200 guests, aggregates happiness/nausea/hunger/thirst and top thoughts, then asks for 3 targeted improvements |
| `scenario-coach.js` | **Copilot Scenario Coach** | Reads the scenario objective and current progress, then asks for a step-by-step completion strategy |

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| [OpenRCT2](https://openrct2.org) v0.4.9+ | scripting API v77 |
| [Node.js](https://nodejs.org) ≥ 20 | for the companion server |
| GitHub Copilot access **or** a BYOK API key | see Authentication below |

---

## Quick start

### 1 — Install companion server dependencies

```bash
cd contrib/copilot-plugin
npm install
```

### 2 — Authenticate

**Option A – GitHub Copilot (default)**

Install the [GitHub CLI](https://cli.github.com) and log in with an account that has Copilot access:

```bash
gh auth login
```

**Option B – Bring Your Own Key (BYOK)**

Export environment variables before starting the server:

```bash
# OpenAI
export BYOK_BASE_URL=https://api.openai.com/v1
export BYOK_API_KEY=sk-...
export BYOK_MODEL=gpt-4o          # optional, default: gpt-4o

# Azure AI Foundry
export BYOK_PROVIDER=openai
export BYOK_BASE_URL=https://my-resource.openai.azure.com/openai/v1/
export BYOK_API_KEY=...

# Anthropic
export BYOK_PROVIDER=anthropic
export BYOK_BASE_URL=https://api.anthropic.com
export BYOK_API_KEY=sk-ant-...
export BYOK_MODEL=claude-sonnet-4-5

# Ollama / local (no key required)
export BYOK_BASE_URL=http://localhost:11434/v1
```

### 3 — Start the server

```bash
npm start
# Copilot Plugin Suite server listening on 127.0.0.1:9001
```

### 4 — Install the plugins

Copy (or symlink) the four `.js` files into your OpenRCT2 plugin directory:

| Platform | Path |
|----------|------|
| Windows  | `%USERPROFILE%\Documents\OpenRCT2\plugin\` |
| macOS    | `~/Library/Application Support/OpenRCT2/plugin/` |
| Linux    | `~/.config/OpenRCT2/plugin/` |

### 5 — Open a park

Launch OpenRCT2, open any park or scenario. Four new entries appear in the game's top menu bar — one per plugin.

---

## Protocol reference

All messages are newline-terminated UTF-8 JSON on TCP localhost:9001.

### `park-advisor` — `plugin.js`

```json
{ "type": "park-advisor", "parkData": { "name": "Mega Park", "rating": 712, "guests": 1340, "cash": 42000, "bankLoan": 10000, "value": 380000, "rides": [ ... ] } }
```

### `ride-name` — `ride-namer.js`

```json
{ "type": "ride-name", "ride": { "name": "Wooden Coaster 1", "classification": "ride", "excitement": "6.52", "intensity": "7.80", "nausea": "4.10", "age": 24, "totalCustomers": 3200 } }
```

### `guest-mood` — `guest-mood.js`

```json
{ "type": "guest-mood", "stats": { "totalGuests": 450, "sampledGuests": 200, "avgHappiness": 142, "avgNausea": 38, "avgHunger": 210, "avgThirst": 190, "lostGuests": 12, "topThoughts": ["lost (18)", "sick (9)", "good_value (7)"] } }
```

### `scenario-coach` — `scenario-coach.js`

```json
{ "type": "scenario-coach", "data": { "scenarioName": "Dinky Park", "objectiveType": "guestsBy", "targetGuests": 1000, "deadlineYear": 4, "currentYear": 2, "yearsRemaining": 2, "parkRating": 650, "currentGuests": 410, "rideCount": 8 } }
```

### Server response (all types)

```json
{ "type": "response", "content": "1. …\n2. …\n3. …" }
```
```json
{ "type": "error",    "content": "AI request failed: …" }
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Connection error" in the plugin | Make sure the server is running (`npm start`) |
| "Failed to start Copilot client" | Run `gh auth login`, or set `BYOK_BASE_URL` + `BYOK_API_KEY` |
| Plugin not in menu | Confirm the `.js` files are in the plugin directory and reload the game |
| Advice is cut off | Use a model with a larger context window, or reduce the data sent |

