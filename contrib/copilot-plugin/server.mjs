/**
 * Copilot Park Advisor – companion server
 *
 * Listens on TCP localhost:9001 for newline-delimited JSON messages sent by
 * the OpenRCT2 plugin.  Each message is forwarded to the GitHub Copilot SDK
 * (or a BYOK provider) and the AI reply is written back to the same socket.
 *
 * Protocol
 * --------
 * Plugin  → server:  {"type":"query","parkData":{...}}\n
 * Server  → plugin:  {"type":"response","content":"..."}\n
 *                or  {"type":"error","content":"..."}\n
 *
 * Authentication
 * --------------
 * By default the server authenticates through the GitHub Copilot CLI that is
 * bundled as a transitive npm dependency.  To use a BYOK provider instead,
 * set these environment variables before starting the server:
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
// Build the prompt that will be sent to the AI model.
// ---------------------------------------------------------------------------
function buildPrompt(parkData) {
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

            if (message.type !== 'query') continue;

            var prompt = buildPrompt(message.parkData || {});
            var session;
            try {
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
    console.log('Copilot Park Advisor server listening on ' + HOST + ':' + PORT);
    console.log('Place plugin.js in your OpenRCT2 plugin directory and open a park.');
});

process.on('SIGINT', async function () {
    console.log('\nShutting down…');
    await copilotClient.stop();
    tcpServer.close();
    process.exit(0);
});
