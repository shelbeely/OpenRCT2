// Copilot Ride Namer
// Select any ride in your park, ask GitHub Copilot for creative name suggestions,
// then apply your favourite with a single click.
// Requires the companion server: cd contrib/copilot-plugin && npm start

var SERVER_PORT = 9001;
var SERVER_HOST = '127.0.0.1';
var WINDOW_WIDTH = 450;
var WINDOW_HEIGHT = 300;

// Module-level state – one window at a time.
var rideNamerRides = [];
var rideNamerSelectedRideId = -1;
var rideNamerSuggestions = [];
var rideNamerSelectedSuggestion = -1;

// Build a flat list of rides for the listview.
var getRideList = function () {
    var all = map.rides;
    var list = [];
    for (var i = 0; i < all.length; i++) {
        list.push(all[i]);
    }
    return list;
};

var rideListItems = function (rides) {
    var items = [];
    for (var i = 0; i < rides.length; i++) {
        items.push({ cells: [rides[i].name, rides[i].status] });
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

var openRideNamerWindow = function () {
    var existing = ui.getWindow('copilot-ride-namer');
    if (existing) { existing.bringToFront(); return; }

    rideNamerRides = getRideList();
    rideNamerSelectedRideId = -1;
    rideNamerSuggestions = [];
    rideNamerSelectedSuggestion = -1;

    var win = ui.openWindow({
        classification: 'copilot-ride-namer',
        title: 'Copilot Ride Namer',
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        widgets: [
            // Left column header
            {
                type: 'label',
                x: 8, y: 18, width: 210, height: 14,
                text: 'Select a ride:'
            },
            // Ride list
            {
                type: 'listview',
                name: 'rideList',
                x: 8, y: 32, width: 210, height: 210,
                showColumnHeaders: true,
                columns: [{ header: 'Ride', width: 148 }, { header: 'Status', width: 52 }],
                items: rideListItems(rideNamerRides),
                canSelect: true,
                onClick: function (item) {
                    rideNamerSelectedRideId = (item >= 0 && item < rideNamerRides.length)
                        ? rideNamerRides[item].id : -1;
                    win.findWidget('suggestBtn').isDisabled = (rideNamerSelectedRideId === -1);
                }
            },
            // Right column header
            {
                type: 'label',
                x: 226, y: 18, width: 216, height: 14,
                text: 'AI name suggestions:'
            },
            // Suggestions list
            {
                type: 'listview',
                name: 'suggList',
                x: 226, y: 32, width: 216, height: 210,
                showColumnHeaders: false,
                scrollbars: 'vertical',
                columns: [{ width: 210 }],
                items: [{ cells: ['(suggestions appear here)'] }],
                canSelect: true,
                onClick: function (item) {
                    rideNamerSelectedSuggestion = item;
                    win.findWidget('applyBtn').isDisabled =
                        (item < 0 || item >= rideNamerSuggestions.length);
                }
            },
            // Status label
            {
                type: 'label',
                name: 'status',
                x: 8, y: 250, width: WINDOW_WIDTH - 16, height: 14,
                text: 'Select a ride, then click "Suggest Names".'
            },
            // Suggest button
            {
                type: 'button',
                name: 'suggestBtn',
                x: 8, y: 268, width: 160, height: 22,
                text: 'Suggest Names',
                isDisabled: true,
                onClick: function () {
                    if (rideNamerSelectedRideId === -1) { return; }
                    var ride = map.getRide(rideNamerSelectedRideId);
                    if (!ride) { return; }

                    rideNamerSuggestions = [];
                    rideNamerSelectedSuggestion = -1;
                    win.findWidget('suggList').items = [];
                    win.findWidget('applyBtn').isDisabled = true;
                    win.findWidget('suggestBtn').isDisabled = true;
                    win.findWidget('status').text = 'Asking Copilot for name suggestions...';

                    var payload = JSON.stringify({
                        type: 'ride-name',
                        ride: {
                            name: ride.name,
                            classification: ride.classification,
                            excitement: (ride.excitement / 100).toFixed(2),
                            intensity: (ride.intensity / 100).toFixed(2),
                            nausea: (ride.nausea / 100).toFixed(2),
                            status: ride.status,
                            age: ride.age,
                            totalCustomers: ride.totalCustomers
                        }
                    }) + '\n';

                    queryCopilot(payload,
                        function (msg) {
                            win.findWidget('suggestBtn').isDisabled = false;
                            if (msg.type !== 'response') {
                                win.findWidget('status').text = 'Error: ' + (msg.content || 'Unknown');
                                return;
                            }
                            // Parse each "1. Name" line into a clean suggestion.
                            var lines = msg.content.split('\n');
                            rideNamerSuggestions = [];
                            for (var i = 0; i < lines.length; i++) {
                                var cleaned = lines[i].trim().replace(/^\d+[.)]\s*/, '');
                                if (cleaned) { rideNamerSuggestions.push(cleaned); }
                            }
                            var suggItems = [];
                            for (var j = 0; j < rideNamerSuggestions.length; j++) {
                                suggItems.push({ cells: [rideNamerSuggestions[j]] });
                            }
                            win.findWidget('suggList').items = suggItems;
                            win.findWidget('status').text = 'Click a suggestion to select it, then click Apply.';
                        },
                        function (err) {
                            win.findWidget('suggestBtn').isDisabled = false;
                            win.findWidget('status').text = err;
                        }
                    );
                }
            },
            // Apply button
            {
                type: 'button',
                name: 'applyBtn',
                x: 226, y: 268, width: 216, height: 22,
                text: 'Apply Selected Name',
                isDisabled: true,
                onClick: function () {
                    if (rideNamerSelectedRideId === -1) { return; }
                    if (rideNamerSelectedSuggestion < 0 || rideNamerSelectedSuggestion >= rideNamerSuggestions.length) { return; }
                    var newName = rideNamerSuggestions[rideNamerSelectedSuggestion];
                    context.executeAction('ridesetname', { ride: rideNamerSelectedRideId, name: newName }, function (result) {
                        if (result.error) {
                            win.findWidget('status').text = 'Rename failed: ' + (result.errorMessage || 'Unknown error');
                        } else {
                            win.findWidget('status').text = 'Renamed to: ' + newName;
                            // Refresh the ride list to show the updated name.
                            rideNamerRides = getRideList();
                            win.findWidget('rideList').items = rideListItems(rideNamerRides);
                        }
                    });
                }
            }
        ]
    });
};

var main = function () {
    if (typeof ui === 'undefined') { return; }

    ui.registerMenuItem('Copilot Ride Namer', function () {
        openRideNamerWindow();
    });
};

registerPlugin({
    name: 'CopilotRideNamer',
    version: '1.0',
    authors: ['OpenRCT2 Contributors'],
    type: 'local',
    licence: 'MIT',
    targetApiVersion: 77,
    minApiVersion: 68,
    main: main
});
