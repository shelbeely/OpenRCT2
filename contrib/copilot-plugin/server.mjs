/**
 * Copilot Plugin Suite – companion server
 *
 * Listens on TCP localhost:9001 for newline-delimited JSON messages sent by
 * the four OpenRCT2 Copilot plugins. Each message is forwarded to the GitHub
 * Copilot SDK (or a BYOK provider) and the AI reply is written back.
 *
 * Protocol
 * --------
 * Plugin  → server:  {"type":"<query-type>", ...data}\n
 * Server  → plugin:  {"type":"response","content":"..."}\n
 *                or  {"type":"error","content":"..."}\n
 *
 * Query types
 * -----------
 *   park-advisor   – general park management advice   (plugin.js)
 *   ride-name      – creative ride name suggestions   (ride-namer.js)
 *   guest-mood     – guest happiness analysis         (guest-mood.js)
 *   scenario-coach – scenario completion strategy     (scenario-coach.js)
 *
 * Authentication
 * --------------
 * By default the server authenticates through the GitHub Copilot CLI bundled
 * as a transitive npm dependency (@github/copilot).  To use a BYOK provider
 * instead, set these environment variables before starting the server:
 *
 *   BYOK_PROVIDER   – "openai" | "azure" | "anthropic"  (default: "openai")
 *   BYOK_BASE_URL   – full API base URL, e.g. https://api.openai.com/v1
 *   BYOK_API_KEY    – your API key
 *   BYOK_MODEL      – model name, e.g. gpt-4o  (default: "gpt-4o")
 *
 * Usage
 * -----
 *   npm install
 *   npm start
 */

import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { CopilotClient } from '@github/copilot-sdk';

const PORT = 9001;
const HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
// Locate the bundled Copilot CLI so users don't need a separate installation.
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledCli = path.resolve(__dirname, 'node_modules', '@github', 'copilot', 'dist', 'index.js');

const clientOptions = {
    cliPath: process.execPath,   // "node"
    cliArgs: [bundledCli],
};

// ---------------------------------------------------------------------------
// BYOK helper – returns a ProviderConfig when BYOK env vars are present.
// ---------------------------------------------------------------------------
function getByokProvider() {
    if (!process.env.BYOK_BASE_URL) return undefined;
    return {
        type: process.env.BYOK_PROVIDER || 'openai',
        baseUrl: process.env.BYOK_BASE_URL,
        apiKey: process.env.BYOK_API_KEY,
    };
}

// ---------------------------------------------------------------------------
// Prompt builders – one per plugin query type
// ---------------------------------------------------------------------------

function buildParkAdvisorPrompt(parkData) {
    var rides = (parkData.rides || []).map(function (r) {
        return r.name + ' (excitement:' + r.excitement + ', intensity:' + r.intensity +
               ', nausea:' + r.nausea + ', status:' + r.status + ')';
    }).join('; ') || 'none';

    return 'You are an expert theme-park management consultant.\n' +
        'Analyse the following park data and give exactly 3 concise, actionable\n' +
        'recommendations to improve the park rating, guest count, or profit.\n' +
        'Keep your answer under 200 words.\n\n' +
        'Park: ' + (parkData.name || 'Unknown') + '\n' +
        'Rating: ' + parkData.rating + '/999\n' +
        'Guests in park: ' + parkData.guests + '\n' +
        'Cash: $' + (parkData.cash / 10).toFixed(2) + '\n' +
        'Bank loan: $' + (parkData.bankLoan / 10).toFixed(2) + '\n' +
        'Park value: $' + (parkData.value / 10).toFixed(2) + '\n' +
        'Rides: ' + rides;
}

function buildRideNamePrompt(ride) {
    return 'You are a creative theme-park ride designer.\n' +
        'Suggest exactly 5 short, memorable names for the ride described below.\n' +
        'Each name must be on its own numbered line (e.g. "1. Thunderbolt").\n' +
        'Keep each name under 25 characters. No extra explanation.\n\n' +
        'Current name: ' + (ride.name || 'Unknown') + '\n' +
        'Classification: ' + (ride.classification || 'ride') + '\n' +
        'Excitement rating: ' + (ride.excitement || '?') + '/10\n' +
        'Intensity rating: ' + (ride.intensity || '?') + '/10\n' +
        'Nausea rating: ' + (ride.nausea || '?') + '/10\n' +
        'Age: ' + (ride.age || 0) + ' months\n' +
        'Total customers served: ' + (ride.totalCustomers || 0);
}

function buildGuestMoodPrompt(stats) {
    return 'You are a guest experience analyst for a theme park.\n' +
        'Analyse the following aggregate guest data and give exactly 3 concise,\n' +
        'actionable recommendations. Keep your answer under 200 words.\n\n' +
        'Total guests in park: ' + (stats.totalGuests || 0) + '\n' +
        'Sampled guests: ' + (stats.sampledGuests || 0) + '\n' +
        'Average happiness (0–255, higher is better): ' + (stats.avgHappiness || 0) + '\n' +
        'Average nausea (0–255, lower is better): ' + (stats.avgNausea || 0) + '\n' +
        'Average hunger (0–255, lower = more hungry): ' + (stats.avgHunger || 0) + '\n' +
        'Average thirst (0–255, lower = more thirsty): ' + (stats.avgThirst || 0) + '\n' +
        'Lost guests: ' + (stats.lostGuests || 0) + '\n' +
        'Most common thoughts: ' + ((stats.topThoughts || []).join(', ') || 'none');
}

function buildScenarioCoachPrompt(data) {
    var deadline = (data.yearsRemaining !== null && data.yearsRemaining !== undefined)
        ? data.yearsRemaining + ' year(s) remaining (deadline: year ' + data.deadlineYear + ')'
        : 'no fixed deadline';
    return 'You are a scenario completion coach for a theme-park management game.\n' +
        'Provide a focused, step-by-step strategy (max 250 words) to help the\n' +
        'player complete their objective.\n\n' +
        'Scenario: ' + (data.scenarioName || 'Unknown') + '\n' +
        'Objective type: ' + (data.objectiveType || 'unknown') + '\n' +
        'Target guests: ' + (data.targetGuests || 'N/A') + '\n' +
        'Target park value: $' + ((data.targetParkValue || 0) / 10).toFixed(0) + '\n' +
        'Deadline: ' + deadline + '\n\n' +
        'Current status:\n' +
        'Year: ' + (data.currentYear || 1) + '\n' +
        'Park rating: ' + (data.parkRating || 0) + '/999\n' +
        'Current guests: ' + (data.currentGuests || 0) + '\n' +
        'Cash: $' + ((data.currentCash || 0) / 10).toFixed(2) + '\n' +
        'Bank loan: $' + ((data.currentBankLoan || 0) / 10).toFixed(2) + '\n' +
        'Park value: $' + ((data.currentParkValue || 0) / 10).toFixed(0) + '\n' +
        'Number of rides: ' + (data.rideCount || 0);
}

// Route a parsed message to the correct prompt builder.
function buildPrompt(message) {
    switch (message.type) {
        case 'park-advisor':    return buildParkAdvisorPrompt(message.parkData || {});
        case 'ride-name':       return buildRideNamePrompt(message.ride || {});
        case 'guest-mood':      return buildGuestMoodPrompt(message.stats || {});
        case 'scenario-coach':  return buildScenarioCoachPrompt(message.data || {});
        default:                return null;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const copilotClient = new CopilotClient(clientOptions);

try {
    await copilotClient.start();
    console.log('Copilot client started.');
} catch (err) {
    console.error('Failed to start Copilot client:', err.message);
    console.error('Make sure you are logged in with: gh auth login');
    process.exit(1);
}

const byokProvider = getByokProvider();
if (byokProvider) {
    console.log('Using BYOK provider:', byokProvider.type, byokProvider.baseUrl);
} else {
    console.log('Using GitHub Copilot authentication.');
}

const tcpServer = net.createServer(function (socket) {
    console.log('OpenRCT2 plugin connected.');
    var buffer = '';

    socket.on('data', async function (chunk) {
        buffer += chunk.toString();

        var newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            var line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;

            var message;
            try {
                message = JSON.parse(line);
            } catch (_) {
                socket.write(JSON.stringify({ type: 'error', content: 'Invalid JSON.' }) + '\n');
                continue;
            }

            var prompt = buildPrompt(message);
            if (prompt === null) {
                socket.write(JSON.stringify({ type: 'error', content: 'Unknown query type: ' + message.type }) + '\n');
                continue;
            }

            var session;            try {
                var sessionConfig = {
                    model: process.env.BYOK_MODEL || 'gpt-4o',
                };
                if (byokProvider) {
                    sessionConfig.provider = byokProvider;
                }
                session = await copilotClient.createSession(sessionConfig);
                var response = await session.sendAndWait({ prompt: prompt });
                var content = (response && response.data && response.data.content)
                    ? response.data.content
                    : 'No advice returned.';
                socket.write(JSON.stringify({ type: 'response', content: content }) + '\n');
            } catch (err) {
                console.error('Copilot request error:', err.message);
                socket.write(JSON.stringify({ type: 'error', content: 'AI request failed: ' + err.message }) + '\n');
            } finally {
                if (session) {
                    try { await session.destroy(); } catch (_) { /* ignore */ }
                }
            }
        }
    });

    socket.on('error', function (err) {
        console.error('Socket error:', err.message);
    });

    socket.on('close', function () {
        console.log('OpenRCT2 plugin disconnected.');
    });
});

tcpServer.listen(PORT, HOST, function () {
    console.log('Copilot Plugin Suite server listening on ' + HOST + ':' + PORT);
    console.log('Copy plugin.js, ride-namer.js, guest-mood.js, scenario-coach.js to your OpenRCT2 plugin directory.');
});

process.on('SIGINT', async function () {
    console.log('\nShutting down…');
    await copilotClient.stop();
    tcpServer.close();
    process.exit(0);
});
