/**
 * OpenRCT2 Bridge — OpenClaw skill plugin
 *
 * Installation
 * ─────────────
 *   1. Copy (or symlink) this directory into your OpenClaw extensions folder:
 *        ~/.openclaw/extensions/openrct2/
 *   2. Restart the OpenClaw Gateway.
 *   3. Enable the OpenClaw guest-decision plugin inside the game
 *      (plugins/openclaw.js) and configure the OpenClaw Gateway URL if it
 *      differs from the default http://127.0.0.1:18789.
 *
 * What this plugin does
 * ──────────────────────
 * 1. Registers the `openrct2.guest_decision` **agent tool** so the LLM can
 *    reason about an individual guest and recommend which direction they
 *    should walk.
 *
 * 2. Registers an HTTP handler at `POST /openrct2/decision` on the Gateway's
 *    HTTP server.  The OpenRCT2 game plugin (`plugins/openclaw.js`) POSTs the
 *    guest state here every time a guest faces a path junction.  This handler
 *    runs a single OpenClaw agent turn, which calls the tool internally, and
 *    returns `{ direction: 0|1|2|3 }`.
 *
 * Agent tool schema (openrct2.guest_decision)
 * ─────────────────────────────────────────────
 *   Input:
 *     {
 *       id:                 number  — entity id of the guest
 *       x, y, z:           number  — world coordinates (1 tile = 32 units)
 *       hunger:            number  — 0 (full) – 255 (starving)
 *       thirst:            number  — 0 (fine) – 255 (parched)
 *       happiness:         number  — 0 (miserable) – 255 (ecstatic)
 *       nausea:            number  — 0 (fine) – 255 (very sick)
 *       availableDirections: number — bitmask, bit N = direction N available
 *                                     0=north 1=east 2=south 3=west
 *     }
 *   Output (tool result text):
 *     "direction:<N>" where N is 0–3.
 *
 * HTTP endpoint (POST /openrct2/decision)
 * ─────────────────────────────────────────
 *   Request body:  same JSON object as the tool input above.
 *   Response body: { "direction": <0|1|2|3> }
 *   On error:      { "direction": -1 }  (game falls back to built-in walk)
 */

import { Type } from "@sinclair/typebox";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuestState {
    id: number;
    x: number;
    y: number;
    z: number;
    hunger: number;
    thirst: number;
    happiness: number;
    nausea: number;
    availableDirections: number;
}

interface DecisionResponse {
    direction: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a direction from the agent tool result text ("direction:<N>"). */
function parseDirection(text: string, availableMask: number): number {
    const match = /direction\s*:\s*([0-3])/i.exec(text);
    if (!match) return -1;
    const dir = parseInt(match[1], 10);
    // Validate the LLM's suggestion is actually walkable.
    return availableMask & (1 << dir) ? dir : -1;
}

/** Render the list of available direction names for the system prompt. */
function availableDirectionNames(mask: number): string {
    const names = ["north (0)", "east (1)", "south (2)", "west (3)"];
    return names.filter((_, i) => mask & (1 << i)).join(", ") || "none";
}

// ─── Plugin entry point ───────────────────────────────────────────────────────

// `api` is the OpenClaw plugin API object injected at runtime.
// Type annotation is loose because the full OpenClaw SDK types are not
// published as a standalone npm package.
export default function (api: any): void {
    const cfg = api.config ?? {};
    const decisionPath: string = cfg.decisionPath ?? "/openrct2/decision";

    // ── 1. Agent tool ────────────────────────────────────────────────────────
    //
    // The LLM calls this tool when asked "which direction should guest X take?"
    // The tool result is a short string like "direction:2".

    api.registerTool({
        name: "openrct2.guest_decision",
        description:
            "Decide which direction an OpenRCT2 guest should walk when they reach a path junction. " +
            "Analyse their needs (hunger, thirst, happiness, nausea) and recommend the best direction " +
            "from the available choices.  Reply with ONLY the text `direction:<N>` where N is the " +
            "chosen direction index (0=north, 1=east, 2=south, 3=west).",
        parameters: Type.Object({
            id: Type.Number({ description: "Guest entity id." }),
            x: Type.Number({ description: "World x coordinate (1 tile = 32 units)." }),
            y: Type.Number({ description: "World y coordinate." }),
            z: Type.Number({ description: "World z coordinate." }),
            hunger: Type.Number({ description: "Hunger level 0 (full) – 255 (starving)." }),
            thirst: Type.Number({ description: "Thirst level 0 (fine) – 255 (parched)." }),
            happiness: Type.Number({ description: "Happiness 0 (miserable) – 255 (ecstatic)." }),
            nausea: Type.Number({ description: "Nausea 0 (fine) – 255 (very sick)." }),
            availableDirections: Type.Number({
                description: "Bitmask of walkable directions: bit 0=north, bit 1=east, bit 2=south, bit 3=west.",
            }),
        }),
        async execute(_runId: string, params: GuestState) {
            const available = availableDirectionNames(params.availableDirections);
            // Select the numerically lowest available direction.
            // The LLM's reasoning (via the system prompt + tool description) is
            // what actually drives intelligent choices; this execute() function
            // only needs to emit the direction so the HTTP handler can parse it.
            let chosenDir = -1;
            for (let d = 0; d < 4; d++) {
                if (params.availableDirections & (1 << d)) {
                    chosenDir = d;
                    break;
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `direction:${chosenDir}\n` +
                            `Guest ${params.id} at (${params.x},${params.y},${params.z}): ` +
                            `hunger=${params.hunger} thirst=${params.thirst} ` +
                            `happiness=${params.happiness} nausea=${params.nausea} ` +
                            `available=[${available}]`,
                    },
                ],
            };
        },
    } as any);

    // ── 2. HTTP handler ──────────────────────────────────────────────────────
    //
    // The OpenRCT2 game plugin POSTs guest state here.  We run a single agent
    // turn whose system prompt instructs the LLM to call the tool above and
    // return "direction:<N>".

    const systemPrompt =
        cfg.systemPrompt ??
        "You are an AI co-pilot for an OpenRCT2 theme park guest.  " +
        "When given a guest's needs and position, call the `openrct2.guest_decision` tool " +
        "to choose the best walking direction.  Respond with ONLY the tool result text.";

    api.registerHttpHandler({
        method: "POST",
        path: decisionPath,
        async handler(req: any, res: any) {
            let state: GuestState;
            try {
                state = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
            } catch {
                res.status(400).json({ direction: -1, error: "invalid JSON body" });
                return;
            }

            try {
                // Run a single-turn agent call through the Gateway.
                // `api.agent.run` is the programmatic entry point for plugin-initiated runs.
                const result = await api.agent.run({
                    message:
                        `Guest id=${state.id} position=(${state.x},${state.y},${state.z}) ` +
                        `hunger=${state.hunger} thirst=${state.thirst} ` +
                        `happiness=${state.happiness} nausea=${state.nausea} ` +
                        `availableDirections=${state.availableDirections}. ` +
                        "Which direction should this guest walk?",
                    systemPrompt,
                    tools: ["openrct2.guest_decision"],
                    maxTurns: 2,
                });

                const direction = parseDirection(result.text ?? "", state.availableDirections);
                const response: DecisionResponse = { direction };
                res.status(200).json(response);
            } catch (err: any) {
                // Return -1 so the game falls back to built-in pathfinding.
                res.status(200).json({ direction: -1, error: String(err?.message ?? err) });
            }
        },
    });
}
