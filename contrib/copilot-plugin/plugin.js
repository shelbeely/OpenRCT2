// Copilot Park Advisor
// Asks GitHub Copilot for AI-generated management advice about the current park.
// Requires the companion server to be running: cd contrib/copilot-plugin && npm start

var SERVER_PORT = 9001;
var SERVER_HOST = '127.0.0.1';
var WINDOW_WIDTH = 420;
var WINDOW_HEIGHT = 290;
var WRAP_COLS = 54;

// Word-wrap a string into an array of lines no longer than maxCols characters.
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
    if (current.length > 0) {
        lines.push(current);
    }
    return lines;
};

// Collect a snapshot of the current park into a plain object.
var collectParkData = function () {
    var rides = [];
    var allRides = map.rides;
    for (var i = 0; i < allRides.length; i++) {
        var r = allRides[i];
        if (r.classification === 'ride') {
            rides.push({
                name: r.name,
                status: r.status,
                excitement: (r.excitement / 100).toFixed(2),
                intensity: (r.intensity / 100).toFixed(2),
                nausea: (r.nausea / 100).toFixed(2),
                age: r.age,
                downtime: r.downtime,
                totalCustomers: r.totalCustomers
            });
        }
    }
    return {
        name: park.name,
        rating: park.rating,
        guests: park.guests,
        cash: park.cash,
        bankLoan: park.bankLoan,
        value: park.value,
        companyValue: park.companyValue,
        totalAdmissions: park.totalAdmissions,
        rides: rides
    };
};

// Send a query to the companion server and call onResult(msg) with the parsed response.
var queryCopilot = function (payload, onResult, onError) {
    var socket = network.createSocket();
    var buffer = '';

    socket.on('error', function (err) {
        onError('Connection error: ' + err);
    });

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
        if (buffer.trim() !== '') { return; }
        onError('Server closed connection before responding.');
    });

    socket.connect(SERVER_PORT, SERVER_HOST, function () {
        socket.write(payload);
    });
};

// Build listview items by splitting + word-wrapping an AI response string.
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

var openAdvisorWindow = function () {
    var existing = ui.getWindow('copilot-park-advisor');
    if (existing) {
        existing.bringToFront();
        return;
    }

    var win = ui.openWindow({
        classification: 'copilot-park-advisor',
        title: 'Copilot Park Advisor',
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        widgets: [
            {
                type: 'label',
                name: 'status',
                x: 8, y: 18,
                width: WINDOW_WIDTH - 16, height: 14,
                text: 'Click "Ask Copilot" to get AI advice about your park.'
            },
            {
                type: 'listview',
                name: 'adviceList',
                x: 8, y: 36,
                width: WINDOW_WIDTH - 16, height: WINDOW_HEIGHT - 72,
                showColumnHeaders: false,
                scrollbars: 'vertical',
                columns: [{ width: WINDOW_WIDTH - 32 }],
                items: [{ cells: ['(advice will appear here)'] }],
                canSelect: false
            },
            {
                type: 'button',
                name: 'askBtn',
                x: 8, y: WINDOW_HEIGHT - 30,
                width: 180, height: 22,
                text: 'Ask Copilot for Advice',
                onClick: function () {
                    var statusLabel = win.findWidget('status');
                    var askBtn = win.findWidget('askBtn');
                    var list = win.findWidget('adviceList');

                    statusLabel.text = 'Connecting to Copilot server...';
                    askBtn.isDisabled = true;

                    var payload = JSON.stringify({ type: 'park-advisor', parkData: collectParkData() }) + '\n';

                    queryCopilot(payload,
                        function (msg) {
                            if (msg.type === 'response') {
                                list.items = responseToItems(msg.content);
                                statusLabel.text = 'Advice received. Ask again anytime.';
                            } else {
                                statusLabel.text = 'Error: ' + (msg.content || 'Unknown error');
                            }
                            askBtn.isDisabled = false;
                            win.findWidget('parkInfo').text =
                                park.name + '  |  Rating: ' + park.rating + '  |  Guests: ' + park.guests;
                        },
                        function (err) {
                            statusLabel.text = err;
                            askBtn.isDisabled = false;
                        }
                    );
                }
            },
            {
                type: 'label',
                name: 'parkInfo',
                x: 196, y: WINDOW_HEIGHT - 27,
                width: WINDOW_WIDTH - 204, height: 14,
                text: park.name + '  |  Rating: ' + park.rating + '  |  Guests: ' + park.guests
            }
        ]
    });
};

var main = function () {
    if (typeof ui === 'undefined') { return; }

    ui.registerMenuItem('Copilot Park Advisor', function () {
        openAdvisorWindow();
    });
};

registerPlugin({
    name: 'CopilotParkAdvisor',
    version: '1.0',
    authors: ['OpenRCT2 Contributors'],
    type: 'local',
    licence: 'MIT',
    targetApiVersion: 77,
    minApiVersion: 68,
    main: main
});
