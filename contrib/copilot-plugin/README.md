# Copilot Park Advisor – OpenRCT2 Plugin

An OpenRCT2 plugin that connects a live park to the [GitHub Copilot SDK](https://github.com/github/copilot-sdk/tree/main/nodejs) and surfaces AI-generated management advice inside the game.

```
┌─────────────────────────────────────┐
│       Copilot Park Advisor          │
├─────────────────────────────────────┤
│ Status: Advice received.            │
│ ─────────────────────────────────── │
│ 1. Your park rating of 712 is close │
│    to the 750 award threshold. Add  │
│    a gentle flat-ride near the      │
│    entrance to boost it quickly.    │
│                                     │
│ 2. The bank loan ($40 000) costs    │
│    more than your monthly ride      │
│    income. Price your stalls at     │
│    $1.50 to recover cash faster.    │
│                                     │
│ 3. Four rides have >30 % downtime.  │
│    Hire a second mechanic and set   │
│    all inspection intervals to      │
│    10 minutes.                      │
├──────────────────┬──────────────────┤
│ Ask Copilot …   │ MyPark | ★712    │
└──────────────────┴──────────────────┘
```

---

## How it works

The plugin is made of two parts that communicate over a **local TCP socket** (localhost:9001) using newline-delimited JSON – the only networking primitive available to OpenRCT2 scripts (see [scripting.md](../../distribution/scripting.md#can-plugins-communicate-with-other-processes-or-the-internet)).

```
OpenRCT2 game
  └─ plugin.js  ──(TCP localhost:9001)──►  server.mjs
                  {"type":"query","parkData":{…}}           (ES5, Duktape)
                ◄──────────────────────────────────────────
                  {"type":"response","content":"…"}
                                                  └─ @github/copilot-sdk
                                                       └─ GitHub Copilot / BYOK
```

`plugin.js` is a single ECMAScript 5 file that follows the [OpenRCT2 plugin writing guide](../../distribution/scripting.md#writing-scripts):
* Registered with `registerPlugin()`
* No `import` / `require` statements
* No ES6+ syntax (arrow functions, `let`/`const`, template literals, etc.)

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| [OpenRCT2](https://openrct2.org) v0.4.9+ | scripting API v68 |
| [Node.js](https://nodejs.org) ≥ 20 | for the companion server |
| GitHub Copilot access **or** a BYOK API key | see Authentication below |

---

## Quick start

### 1. Install companion server dependencies

```bash
cd contrib/copilot-plugin
npm install
```

### 2. Authenticate

**Option A – GitHub Copilot (default)**

Install the [GitHub CLI](https://cli.github.com) and log in with an account that has Copilot access:

```bash
gh auth login
```

**Option B – Bring Your Own Key (BYOK)**

Export environment variables before starting the server:

```bash
# OpenAI example
export BYOK_BASE_URL=https://api.openai.com/v1
export BYOK_API_KEY=sk-...
export BYOK_MODEL=gpt-4o          # optional, default: gpt-4o

# Azure AI Foundry example
export BYOK_PROVIDER=openai
export BYOK_BASE_URL=https://my-resource.openai.azure.com/openai/v1/
export BYOK_API_KEY=...

# Anthropic example
export BYOK_PROVIDER=anthropic
export BYOK_BASE_URL=https://api.anthropic.com
export BYOK_API_KEY=sk-ant-...
export BYOK_MODEL=claude-sonnet-4-5
```

For local models (Ollama, Microsoft Foundry Local) no API key is required – just set `BYOK_BASE_URL`.

### 3. Start the server

```bash
npm start
# Copilot Park Advisor server listening on 127.0.0.1:9001
```

### 4. Install the plugin

Copy (or symlink) `plugin.js` into your OpenRCT2 plugin directory:

| Platform | Path |
|----------|------|
| Windows  | `%USERPROFILE%\Documents\OpenRCT2\plugin\` |
| macOS    | `~/Library/Application Support/OpenRCT2/plugin/` |
| Linux    | `~/.config/OpenRCT2/plugin/` |

### 5. Open a park

Launch OpenRCT2 and open any park or scenario.  A new **"Copilot Park Advisor"** entry appears in the game's top menu bar.  Click it to open the advisor window, then press **"Ask Copilot for Advice"**.

---

## Protocol reference

All messages are newline-terminated UTF-8 JSON.

### Plugin → server

```json
{
  "type": "query",
  "parkData": {
    "name": "Mega Park",
    "rating": 712,
    "guests": 1340,
    "cash": 42000,
    "bankLoan": 10000,
    "value": 380000,
    "companyValue": 412000,
    "totalAdmissions": 8921,
    "rides": [
      {
        "name": "Wooden Roller Coaster 1",
        "status": "open",
        "excitement": "6.52",
        "intensity": "7.80",
        "nausea": "4.10",
        "age": 24,
        "downtime": 0,
        "totalCustomers": 3200
      }
    ]
  }
}
```

### Server → plugin

```json
{ "type": "response", "content": "1. …\n2. …\n3. …" }
```

```json
{ "type": "error", "content": "AI request failed: …" }
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Connection error" in the plugin | Make sure the server is running (`npm start`) |
| "Failed to start Copilot client" | Run `gh auth login` or set BYOK env vars |
| Advice is cut off | Increase `BYOK_MODEL` context window or ask a more targeted question |
| Plugin not in menu | Confirm `plugin.js` is in the plugin directory and the game was restarted |
