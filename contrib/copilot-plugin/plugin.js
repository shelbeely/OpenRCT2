/**
 * Copilot Park Advisor – OpenRCT2 plugin
 *
 * Connects to the companion server (server.mjs, localhost:9001) and provides
 * an in-game window that asks GitHub Copilot for AI-generated advice about
 * the current park.
 *
 * Requirements
 * ------------
 *  • OpenRCT2 scripting API v68+
 *  • The companion server must be running: cd contrib/copilot-plugin && npm start
 *
 * Installation
 * ------------
 *  Copy this file into the OpenRCT2 plugin directory (see scripting.md for
 *  the path on your platform) then open any park.
 */

/* global registerPlugin, ui, network, park, map, context */

(function () {
    'use strict';

    var SERVER_PORT = 9001;
    var SERVER_HOST = '127.0.0.1';
    var WINDOW_CLASS = 'copilot-park-advisor';

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Format an integer that the game stores as tenths of currency. */
    function formatCash(raw) {
        return '$' + (raw / 10).toFixed(2);
    }

    /** Collect current park statistics into a plain object. */
    function collectParkData() {
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
                    totalCustomers: r.totalCustomers,
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
            rides: rides,
        };
    }

    /**
     * Word-wrap a string into an array of lines no longer than maxWidth chars.
     * Lines are broken on whitespace where possible.
     */
    function wrapText(text, maxWidth) {
        var words = text.split(' ');
        var lines = [];
        var current = '';
        for (var i = 0; i < words.length; i++) {
            var word = words[i];
            if (current.length === 0) {
                current = word;
            } else if (current.length + 1 + word.length <= maxWidth) {
                current = current + ' ' + word;
            } else {
                lines.push(current);
                current = word;
            }
        }
        if (current.length > 0) lines.push(current);
        return lines;
    }

    // -----------------------------------------------------------------------
    // UI window
    // -----------------------------------------------------------------------

    var WINDOW_WIDTH = 420;
    var WINDOW_HEIGHT = 330;
    var WRAP_COLS = 54;         // approximate characters that fit the list column

    function openAdvisorWindow() {
        // Bring existing window to front if already open.
        var existing = ui.getWindow(WINDOW_CLASS);
        if (existing) {
            existing.bringToFront();
            return;
        }

        var win = ui.openWindow({
            classification: WINDOW_CLASS,
            title: 'Copilot Park Advisor',
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            widgets: [
                // Status / connection feedback
                {
                    type: 'label',
                    name: 'status',
                    x: 8,
                    y: 18,
                    width: WINDOW_WIDTH - 16,
                    height: 14,
                    text: 'Ready. Click the button below to get AI advice.',
                },

                // Scrollable advice area
                {
                    type: 'listview',
                    name: 'adviceList',
                    x: 8,
                    y: 36,
                    width: WINDOW_WIDTH - 16,
                    height: WINDOW_HEIGHT - 36 - 34,
                    showColumnHeaders: false,
                    scrollbars: 'vertical',
                    columns: [{ width: WINDOW_WIDTH - 32 }],
                    items: [{ cells: ['(advice will appear here)'] }],
                    canSelect: false,
                },

                // Ask button
                {
                    type: 'button',
                    name: 'askBtn',
                    x: 8,
                    y: WINDOW_HEIGHT - 30,
                    width: 180,
                    height: 22,
                    text: 'Ask Copilot for Advice',
                    onClick: function () { onAskClicked(win); },
                },

                // Snapshot label (park name / rating shown for context)
                {
                    type: 'label',
                    name: 'parkInfo',
                    x: 196,
                    y: WINDOW_HEIGHT - 27,
                    width: WINDOW_WIDTH - 204,
                    height: 14,
                    text: '',
                },
            ],
        });

        // Show a quick park snapshot in the footer.
        refreshParkInfo(win);
    }

    function refreshParkInfo(win) {
        if (!win) return;
        var label = win.findWidget('parkInfo');
        if (label) {
            label.text = park.name + ' | Rating: ' + park.rating + ' | Guests: ' + park.guests;
        }
    }

    /**
     * Called when the user clicks "Ask Copilot for Advice".
     * Collects park data, sends it to the companion server via TCP, then
     * updates the list view when the response arrives.
     */
    function onAskClicked(win) {
        var statusLabel = win.findWidget('status');
        var askBtn = win.findWidget('askBtn');
        var list = win.findWidget('adviceList');

        if (statusLabel) statusLabel.text = 'Connecting to Copilot server…';
        if (askBtn) askBtn.isDisabled = true;

        var parkData = collectParkData();
        var payload = JSON.stringify({ type: 'query', parkData: parkData }) + '\n';

        var socket = network.createSocket();
        var responseBuffer = '';

        socket.on('error', function (err) {
            if (statusLabel) statusLabel.text = 'Connection error: ' + err;
            if (askBtn) askBtn.isDisabled = false;
        });

        socket.on('data', function (chunk) {
            responseBuffer += chunk;

            var newlineIndex = responseBuffer.indexOf('\n');
            if (newlineIndex === -1) return;

            var line = responseBuffer.slice(0, newlineIndex).trim();
            responseBuffer = responseBuffer.slice(newlineIndex + 1);

            var msg;
            try {
                msg = JSON.parse(line);
            } catch (_) {
                if (statusLabel) statusLabel.text = 'Received invalid response from server.';
                if (askBtn) askBtn.isDisabled = false;
                socket.end();
                return;
            }

            if (msg.type === 'response') {
                var lines = msg.content.split('\n');
                var wrappedItems = [];
                for (var i = 0; i < lines.length; i++) {
                    var wrapped = wrapText(lines[i], WRAP_COLS);
                    if (wrapped.length === 0) {
                        wrappedItems.push({ cells: [''] });
                    } else {
                        for (var j = 0; j < wrapped.length; j++) {
                            wrappedItems.push({ cells: [wrapped[j]] });
                        }
                    }
                }
                if (list) list.items = wrappedItems;
                if (statusLabel) statusLabel.text = 'Advice received. Ask again anytime.';
            } else {
                if (statusLabel) statusLabel.text = 'Error: ' + (msg.content || 'Unknown error');
                if (list) list.items = [{ cells: ['See status bar above.'] }];
            }

            if (askBtn) askBtn.isDisabled = false;
            refreshParkInfo(win);
            socket.end();
        });

        socket.on('close', function () {
            // If we never received data, show a helpful message.
            if (responseBuffer.trim() !== '') return;
            if (askBtn && askBtn.isDisabled) {
                if (statusLabel) {
                    statusLabel.text = 'Server closed connection before responding.';
                }
                if (askBtn) askBtn.isDisabled = false;
            }
        });

        socket.connect(SERVER_PORT, SERVER_HOST, function () {
            if (statusLabel) statusLabel.text = 'Connected. Waiting for Copilot…';
            socket.write(payload);
        });
    }

    // -----------------------------------------------------------------------
    // Plugin registration
    // -----------------------------------------------------------------------

    function main() {
        if (typeof ui === 'undefined') {
            // Headless / server mode – UI is unavailable.
            return;
        }

        ui.registerMenuItem('Copilot Park Advisor', function () {
            openAdvisorWindow();
        });

        console.log('[CopilotAdvisor] Plugin loaded. Open the menu to launch the advisor window.');
    }

    registerPlugin({
        name: 'CopilotParkAdvisor',
        version: '1.0',
        authors: ['OpenRCT2 Contributors'],
        type: 'local',
        licence: 'MIT',
        targetApiVersion: 68,
        minApiVersion: 68,
        main: main,
    });
}());
