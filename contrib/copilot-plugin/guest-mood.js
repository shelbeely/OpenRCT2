// Copilot Guest Mood Analyst
// Samples up to 200 guests, aggregates their happiness/nausea/hunger/thirst and
// most common thoughts, then asks GitHub Copilot for targeted recommendations.
// Requires the companion server: cd contrib/copilot-plugin && npm start

var SERVER_PORT = 9001;
var SERVER_HOST = '127.0.0.1';
var WINDOW_WIDTH = 400;
var WINDOW_HEIGHT = 310;
var SAMPLE_LIMIT = 200;
var WRAP_COLS = 50;

var wrapText = function (text, maxCols) {
    var words = text.split(' ');
    var lines = [];
    var current = '';
    for (var i = 0; i < words.length; i++) {
        var word = words[i];
        if (current.length === 0) {
            current = word;
        } else if (current.length + 1 + word.length <= maxCols) {
            current = current + ' ' + word;
        } else {
            lines.push(current);
            current = word;
        }
    }
    if (current.length > 0) { lines.push(current); }
    return lines;
};

var responseToItems = function (content) {
    var paragraphs = content.split('\n');
    var items = [];
    for (var i = 0; i < paragraphs.length; i++) {
        var wrapped = wrapText(paragraphs[i], WRAP_COLS);
        if (wrapped.length === 0) {
            items.push({ cells: [''] });
        } else {
            for (var j = 0; j < wrapped.length; j++) {
                items.push({ cells: [wrapped[j]] });
            }
        }
    }
    return items;
};

// Sample up to SAMPLE_LIMIT in-park guests and return aggregate stats.
var sampleGuests = function () {
    var all = map.getAllEntities('guest');
    var totalInPark = 0;
    var sampled = 0;
    var sumHappiness = 0;
    var sumNausea = 0;
    var sumHunger = 0;
    var sumThirst = 0;
    var lostCount = 0;
    var thoughtCounts = {};

    for (var i = 0; i < all.length; i++) {
        var g = all[i];
        if (!g.isInPark) { continue; }
        totalInPark++;
        if (sampled >= SAMPLE_LIMIT) { continue; }

        sampled++;
        sumHappiness += g.happiness;
        sumNausea += g.nausea;
        sumHunger += g.hunger;
        sumThirst += g.thirst;
        if (g.isLost) { lostCount++; }

        var thoughts = g.thoughts;
        for (var t = 0; t < thoughts.length; t++) {
            var tt = thoughts[t].type;
            thoughtCounts[tt] = (thoughtCounts[tt] || 0) + 1;
        }
    }

    // Find the top-3 most common thought types.
    var topThoughts = [];
    for (var key in thoughtCounts) {
        topThoughts.push({ type: key, count: thoughtCounts[key] });
    }
    topThoughts.sort(function (a, b) { return b.count - a.count; });
    var topThoughtTypes = [];
    for (var k = 0; k < Math.min(3, topThoughts.length); k++) {
        topThoughtTypes.push(topThoughts[k].type + ' (' + topThoughts[k].count + ')');
    }

    return {
        totalGuests: totalInPark,
        sampledGuests: sampled,
        avgHappiness: sampled > 0 ? Math.round(sumHappiness / sampled) : 0,
        avgNausea: sampled > 0 ? Math.round(sumNausea / sampled) : 0,
        avgHunger: sampled > 0 ? Math.round(sumHunger / sampled) : 0,
        avgThirst: sampled > 0 ? Math.round(sumThirst / sampled) : 0,
        lostGuests: lostCount,
        topThoughts: topThoughtTypes
    };
};

var queryCopilot = function (payload, onResult, onError) {
    var socket = network.createSocket();
    var buffer = '';

    socket.on('error', function (err) { onError('Connection error: ' + err); });

    socket.on('data', function (chunk) {
        buffer += chunk;
        var nl = buffer.indexOf('\n');
        if (nl === -1) { return; }
        var line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        try {
            onResult(JSON.parse(line));
        } catch (_) {
            onError('Invalid response from server.');
        }
        socket.end();
    });

    socket.on('close', function () {
        if (buffer.trim() === '') { onError('Server closed connection before responding.'); }
    });

    socket.connect(SERVER_PORT, SERVER_HOST, function () { socket.write(payload); });
};

var openGuestMoodWindow = function () {
    var existing = ui.getWindow('copilot-guest-mood');
    if (existing) { existing.bringToFront(); return; }

    var win = ui.openWindow({
        classification: 'copilot-guest-mood',
        title: 'Copilot Guest Mood Analyst',
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        widgets: [
            // Stat labels – left column
            { type: 'label', name: 'lblGuests',    x: 8,   y: 18, width: 188, height: 14, text: 'Guests in park: --' },
            { type: 'label', name: 'lblHappiness', x: 8,   y: 34, width: 188, height: 14, text: 'Avg happiness: --' },
            { type: 'label', name: 'lblNausea',    x: 8,   y: 50, width: 188, height: 14, text: 'Avg nausea: --' },
            // Stat labels – right column
            { type: 'label', name: 'lblHunger',    x: 204, y: 18, width: 188, height: 14, text: 'Avg hunger: --' },
            { type: 'label', name: 'lblThirst',    x: 204, y: 34, width: 188, height: 14, text: 'Avg thirst: --' },
            { type: 'label', name: 'lblLost',      x: 204, y: 50, width: 188, height: 14, text: 'Lost guests: --' },
            // Top thoughts
            { type: 'label', name: 'lblThoughts',  x: 8,   y: 66, width: WINDOW_WIDTH - 16, height: 14, text: 'Top thoughts: --' },
            // Divider / advice area
            {
                type: 'listview',
                name: 'adviceList',
                x: 8, y: 84,
                width: WINDOW_WIDTH - 16, height: WINDOW_HEIGHT - 120,
                showColumnHeaders: false,
                scrollbars: 'vertical',
                columns: [{ width: WINDOW_WIDTH - 32 }],
                items: [{ cells: ['(recommendations will appear here)'] }],
                canSelect: false
            },
            // Status label
            {
                type: 'label',
                name: 'status',
                x: 8, y: WINDOW_HEIGHT - 32, width: WINDOW_WIDTH - 16, height: 14,
                text: 'Click "Analyse Guests" to sample the park and get AI recommendations.'
            },
            // Analyse button
            {
                type: 'button',
                name: 'analyseBtn',
                x: 8, y: WINDOW_HEIGHT - 16, width: 160, height: 14,
                text: 'Analyse Guests',
                onClick: function () {
                    win.findWidget('analyseBtn').isDisabled = true;
                    win.findWidget('status').text = 'Sampling guests...';

                    var stats = sampleGuests();

                    // Update stat labels immediately with sampled values.
                    win.findWidget('lblGuests').text    = 'Guests in park: ' + stats.totalGuests + ' (sampled ' + stats.sampledGuests + ')';
                    win.findWidget('lblHappiness').text = 'Avg happiness: ' + stats.avgHappiness + '/255';
                    win.findWidget('lblNausea').text    = 'Avg nausea: ' + stats.avgNausea + '/255';
                    win.findWidget('lblHunger').text    = 'Avg hunger: ' + stats.avgHunger + '/255';
                    win.findWidget('lblThirst').text    = 'Avg thirst: ' + stats.avgThirst + '/255';
                    win.findWidget('lblLost').text      = 'Lost guests: ' + stats.lostGuests;
                    win.findWidget('lblThoughts').text  = 'Top thoughts: ' +
                        (stats.topThoughts.length > 0 ? stats.topThoughts.join(', ') : 'none');

                    win.findWidget('status').text = 'Asking Copilot for recommendations...';

                    var payload = JSON.stringify({ type: 'guest-mood', stats: stats }) + '\n';

                    queryCopilot(payload,
                        function (msg) {
                            win.findWidget('analyseBtn').isDisabled = false;
                            if (msg.type === 'response') {
                                win.findWidget('adviceList').items = responseToItems(msg.content);
                                win.findWidget('status').text = 'Analysis complete. Click again to refresh.';
                            } else {
                                win.findWidget('status').text = 'Error: ' + (msg.content || 'Unknown error');
                            }
                        },
                        function (err) {
                            win.findWidget('analyseBtn').isDisabled = false;
                            win.findWidget('status').text = err;
                        }
                    );
                }
            }
        ]
    });
};

var main = function () {
    if (typeof ui === 'undefined') { return; }

    ui.registerMenuItem('Copilot Guest Mood', function () {
        openGuestMoodWindow();
    });
};

registerPlugin({
    name: 'CopilotGuestMood',
    version: '1.0',
    authors: ['OpenRCT2 Contributors'],
    type: 'local',
    licence: 'MIT',
    targetApiVersion: 77,
    minApiVersion: 68,
    main: main
});
