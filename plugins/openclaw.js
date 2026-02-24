/*****************************************************************************
 * Copyright (c) 2014-2026 OpenRCT2 developers
 *
 * For a complete list of all authors, please refer to contributors.md
 * Interested in contributing? Visit https://github.com/OpenRCT2/OpenRCT2
 *
 * OpenRCT2 is licensed under the GNU General Public License version 3.
 *****************************************************************************/

/**
 * OpenClaw — a lightweight agent-runtime plugin for OpenRCT2.
 *
 * Architecture overview
 * ─────────────────────
 * OpenClaw is inspired by modern AI-agent frameworks (tool-calling agents,
 * goal-directed planning).  Each guest is treated as an autonomous agent that
 * runs a short "think" cycle every time it reaches a path junction.
 *
 * Agent loop (per junction):
 *   1. Gather observations   — read the guest's need-levels and nearby map data.
 *   2. Score each direction  — call tool functions that estimate the utility of
 *                              walking in each available direction.
 *   3. Choose best direction — pick the direction with the highest aggregated
 *                              score, breaking ties randomly.
 *   4. Commit the decision   — write `e.direction` back into the hook event so
 *                              the game engine moves the guest accordingly.
 *
 * Built-in tools
 * ──────────────
 *  • nearestRideScore   — rewards directions that bring the guest closer to any
 *                         open ride entrance.
 *  • hungerScore        — rewards directions toward ride/shop entrances when the
 *                         guest is hungry (hunger > 128).
 *  • thirstScore        — same idea for thirst.
 *  • explorationBonus   — small random noise so agents do not all converge on
 *                         the same path.
 *
 * Extending OpenClaw
 * ──────────────────
 * Call `OpenClaw.registerTool(name, fn)` to add a new scoring function.
 * `fn` receives `(guestId, direction, e)` and must return a numeric score.
 * Higher is better.  Tools are additive: all tool scores are summed.
 *
 * Example — steer every hungry guest toward the nearest food stall:
 *
 *   OpenClaw.registerTool("foodStallBonus", function(guestId, dir, e) {
 *       if (e.hunger < 100) return 0;          // not hungry
 *       // ... compute distance to nearest food stall in `dir` ...
 *       return score;
 *   });
 */

/// <reference path="../distribution/openrct2.d.ts" />

registerPlugin({
    name: "OpenClaw",
    version: "1.0.0",
    authors: ["OpenRCT2 contributors"],
    type: "local",
    licence: "GPL-3.0",
    targetApiVersion: 110,
    main: openClawMain
});

// ─── Constants ────────────────────────────────────────────────────────────────

/** One tile is 32 world units in each horizontal axis. */
var TILE_SIZE = 32;

/** Number of orthogonal directions. */
var NUM_DIRECTIONS = 4;

/** Needs are on a 0–255 scale; this threshold marks "hungry / thirsty". */
var NEEDS_THRESHOLD = 128;

/** Weight applied to need-driven tool scores. */
var NEEDS_WEIGHT = 3;

/** Maximum random noise added per direction to avoid deterministic herding. */
var EXPLORATION_NOISE = 0.5;

// ─── OpenClaw runtime ────────────────────────────────────────────────────────

var OpenClaw = (function () {
    /** @type {Array<{name: string, fn: function}>} */
    var _tools = [];

    /**
     * Register a scoring tool.
     * @param {string}   name  Human-readable identifier (for logging).
     * @param {function} fn    `(guestId, direction, eventArgs) => number`
     */
    function registerTool(name, fn) {
        _tools.push({ name: name, fn: fn });
    }

    /**
     * Run the agent decision loop for a single guest at a junction.
     * Returns the chosen direction (0–3) or -1 to defer to built-in logic.
     *
     * @param {number} guestId
     * @param {GuestDecisionArgs} e
     * @returns {number}
     */
    function decide(guestId, e) {
        var best = -1;
        var bestScore = -Infinity;

        for (var dir = 0; dir < NUM_DIRECTIONS; dir++) {
            // Only consider directions the guest can actually walk in.
            if (!(e.availableDirections & (1 << dir))) continue;

            var total = 0;
            for (var i = 0; i < _tools.length; i++) {
                try {
                    total += _tools[i].fn(guestId, dir, e);
                } catch (_err) {
                    // A buggy tool must never crash the game loop.
                }
            }

            if (total > bestScore) {
                bestScore = total;
                best = dir;
            }
        }

        return best;
    }

    return { registerTool: registerTool, decide: decide };
}());

// ─── Built-in tools ───────────────────────────────────────────────────────────

// Lookup tables for direction offsets: index = direction (0=N, 1=E, 2=S, 3=W)
var DIR_DX = [0, 1, 0, -1];
var DIR_DY = [-1, 0, 1, 0];

/**
 * Compute the current and next tile coordinates for a guest moving in `dir`.
 * Returns `{ guestTileX, guestTileY, nextTileX, nextTileY }`.
 *
 * @param {GuestDecisionArgs} e
 * @param {number} dir
 */
function tileStepForDirection(e, dir) {
    var guestTileX = e.x / TILE_SIZE;
    var guestTileY = e.y / TILE_SIZE;
    return {
        guestTileX: guestTileX,
        guestTileY: guestTileY,
        nextTileX: guestTileX + DIR_DX[dir],
        nextTileY: guestTileY + DIR_DY[dir]
    };
}

/**
 * Return the best (maximum) Manhattan-distance improvement toward any open ride
 * entrance achieved by moving in the given direction, scaled by `weight`.
 *
 * @param {GuestDecisionArgs} e
 * @param {number} dir
 * @param {number} weight  Multiplier applied to each delta value.
 * @returns {number}
 */
function bestRideApproachDelta(e, dir, weight) {
    var rides = map.rides;
    if (!rides || rides.length === 0) return 0;

    var step = tileStepForDirection(e, dir);
    var best = 0;

    for (var i = 0; i < rides.length; i++) {
        var ride = rides[i];
        if (!ride || ride.status !== "open") continue;

        var stations = ride.stations;
        if (!stations) continue;

        for (var s = 0; s < stations.length; s++) {
            var entrance = stations[s].entrance;
            if (!entrance) continue;

            var curDist = Math.abs(step.guestTileX - entrance.x) + Math.abs(step.guestTileY - entrance.y);
            var newDist = Math.abs(step.nextTileX - entrance.x) + Math.abs(step.nextTileY - entrance.y);
            var delta = (curDist - newDist) * weight; // positive = approaching

            if (delta > best) best = delta;
        }
    }

    return best;
}

/**
 * Score based on Manhattan-distance change toward the nearest open ride entrance.
 * Positive = getting closer, negative = moving away.
 */
OpenClaw.registerTool("nearestRideScore", function (_guestId, dir, e) {
    return bestRideApproachDelta(e, dir, 1);
});

/**
 * When the guest is hungry, strongly reward directions that move toward any
 * ride/shop entrance (food stalls are rides flagged as shops in OpenRCT2).
 */
OpenClaw.registerTool("hungerScore", function (_guestId, dir, e) {
    if (e.hunger < NEEDS_THRESHOLD) return 0;
    return bestRideApproachDelta(e, dir, NEEDS_WEIGHT);
});

/**
 * When the guest is thirsty, reward directions toward any open ride/shop.
 */
OpenClaw.registerTool("thirstScore", function (_guestId, dir, e) {
    if (e.thirst < NEEDS_THRESHOLD) return 0;
    return bestRideApproachDelta(e, dir, NEEDS_WEIGHT);
});

/**
 * Small random exploration bonus so agents occasionally explore new paths
 * rather than always taking the locally-optimal route.
 */
OpenClaw.registerTool("explorationBonus", function (_guestId, _dir, _e) {
    return Math.random() * EXPLORATION_NOISE;
});

// ─── Hook subscription ────────────────────────────────────────────────────────

function openClawMain() {
    context.subscribe("guest.decision", function (e) {
        var chosen = OpenClaw.decide(e.id, e);
        if (chosen >= 0) {
            e.direction = chosen;
        }
    });

    console.log("[OpenClaw] Agent runtime active — guests will make need-aware decisions at path junctions.");
}
