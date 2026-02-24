// Copilot Scenario Coach
// Reads the current scenario objective and your park's progress, then asks
// GitHub Copilot for a focused step-by-step strategy to complete the scenario.
// Requires the companion server: cd contrib/copilot-plugin && npm start

var SERVER_PORT = 9001;
var SERVER_HOST = '127.0.0.1';
var WINDOW_WIDTH = 430;
var WINDOW_HEIGHT = 320;
var WRAP_COLS = 55;

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

// Collect scenario + current progress into a single object.
var collectScenarioData = function () {
    var obj = scenario.objective;
    return {
        scenarioName: scenario.name,
        objectiveType: obj.type,
        targetGuests: obj.guests,
        targetParkValue: obj.parkValue,
        deadlineYear: obj.year,
        currentYear: date.year,
        yearsRemaining: obj.year > 0 ? obj.year - date.year : null,
        parkRating: park.rating,
        currentGuests: park.guests,
        currentCash: park.cash,
        currentBankLoan: park.bankLoan,
        currentParkValue: park.value,
        rideCount: map.rides.length
    };
};

var formatObjective = function (data) {
    var type = data.objectiveType;
    if (type === 'guestsBy' || type === 'guestsAndRating') {
        return type + ': ' + data.targetGuests + ' guests by year ' + data.deadlineYear;
    }
    if (type === 'parkValueBy' || type === 'repayLoanAndParkValue') {
        return type + ': $' + (data.targetParkValue / 10).toFixed(0) + ' by year ' + data.deadlineYear;
    }
    return type + (data.deadlineYear > 0 ? ' (deadline: year ' + data.deadlineYear + ')' : '');
};

var openScenarioCoachWindow = function () {
    var existing = ui.getWindow('copilot-scenario-coach');
    if (existing) { existing.bringToFront(); return; }

    var data = collectScenarioData();
    var objText = formatObjective(data);

    var win = ui.openWindow({
        classification: 'copilot-scenario-coach',
        title: 'Copilot Scenario Coach',
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        widgets: [
            // Scenario info – left column
            { type: 'label', name: 'lblScenario',  x: 8,   y: 18, width: 210, height: 14, text: 'Scenario: ' + data.scenarioName },
            { type: 'label', name: 'lblObjective', x: 8,   y: 34, width: WINDOW_WIDTH - 16, height: 14, text: 'Objective: ' + objText },
            // Progress – left column
            { type: 'label', name: 'lblRating',    x: 8,   y: 52, width: 210, height: 14, text: 'Park rating: ' + data.parkRating },
            { type: 'label', name: 'lblGuests',    x: 8,   y: 68, width: 210, height: 14, text: 'Guests: ' + data.currentGuests },
            // Progress – right column
            { type: 'label', name: 'lblYear',      x: 220, y: 52, width: 202, height: 14, text: 'Year: ' + data.currentYear + (data.yearsRemaining !== null ? ' (' + data.yearsRemaining + ' left)' : '') },
            { type: 'label', name: 'lblValue',     x: 220, y: 68, width: 202, height: 14, text: 'Park value: $' + (data.currentParkValue / 10).toFixed(0) },
            // Strategy listview
            {
                type: 'listview',
                name: 'strategyList',
                x: 8, y: 88,
                width: WINDOW_WIDTH - 16, height: WINDOW_HEIGHT - 124,
                showColumnHeaders: false,
                scrollbars: 'vertical',
                columns: [{ width: WINDOW_WIDTH - 32 }],
                items: [{ cells: ['(strategy will appear here)'] }],
                canSelect: false
            },
            // Status
            {
                type: 'label',
                name: 'status',
                x: 8, y: WINDOW_HEIGHT - 32, width: WINDOW_WIDTH - 16, height: 14,
                text: 'Click "Get Strategy" for an AI plan to complete the scenario.'
            },
            // Button
            {
                type: 'button',
                name: 'coachBtn',
                x: 8, y: WINDOW_HEIGHT - 16, width: 160, height: 14,
                text: 'Get Strategy',
                onClick: function () {
                    win.findWidget('coachBtn').isDisabled = true;
                    win.findWidget('status').text = 'Asking Copilot for a strategy...';

                    // Refresh data at click time so it reflects latest progress.
                    var freshData = collectScenarioData();
                    win.findWidget('lblRating').text  = 'Park rating: ' + freshData.parkRating;
                    win.findWidget('lblGuests').text  = 'Guests: ' + freshData.currentGuests;
                    win.findWidget('lblYear').text    = 'Year: ' + freshData.currentYear +
                        (freshData.yearsRemaining !== null ? ' (' + freshData.yearsRemaining + ' left)' : '');
                    win.findWidget('lblValue').text   = 'Park value: $' + (freshData.currentParkValue / 10).toFixed(0);

                    var payload = JSON.stringify({ type: 'scenario-coach', data: freshData }) + '\n';

                    queryCopilot(payload,
                        function (msg) {
                            win.findWidget('coachBtn').isDisabled = false;
                            if (msg.type === 'response') {
                                win.findWidget('strategyList').items = responseToItems(msg.content);
                                win.findWidget('status').text = 'Strategy ready. Click again to refresh.';
                            } else {
                                win.findWidget('status').text = 'Error: ' + (msg.content || 'Unknown error');
                            }
                        },
                        function (err) {
                            win.findWidget('coachBtn').isDisabled = false;
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

    ui.registerMenuItem('Copilot Scenario Coach', function () {
        openScenarioCoachWindow();
    });
};

registerPlugin({
    name: 'CopilotScenarioCoach',
    version: '1.0',
    authors: ['OpenRCT2 Contributors'],
    type: 'local',
    licence: 'MIT',
    targetApiVersion: 77,
    minApiVersion: 68,
    main: main
});
