define(function(require, exports, module) {
    main.consumes = [
        "api", "c9", "collab.workspace", "commands", "editors", "fs", "layout",
        "menus", "Plugin", "preferences", "preview", "proc", "settings", "ui"
    ];
    main.provides = ["harvard.cs50.info"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;

        var api = imports.api;
        var c9 = imports.c9;
        var commands = imports.commands;
        var editors = imports.editors;
        var fs = imports.fs;
        var layout = imports.layout;
        var menus = imports.menus;
        var prefs = imports.preferences;
        var preview = imports.preview;
        var proc = imports.proc;
        var settings = imports.settings;
        var ui = imports.ui;
        var workspace = imports["collab.workspace"];

        var _ = require("lodash");

        var INFO_VER = 1;

        /***** Initialization *****/

        var plugin = new Plugin("CS50", main.consumes);

        // UI buttons
        var versionBtn;

        var DEFAULT_REFRESH = 30;   // default refresh rate
        var delay;                  // current refresh rate
        var fetching;               // are we fetching data
        var stats = null;           // last recorded stats
        var timer = null;           // javascript interval ID
        var domain = null;          // current domain
        var BIN = "~/bin/";         // location of .info50 script
        var permissions = "755";    // permissions given to .info50 script
        var presenting = false;
        var VERSION_PATH = "project/cs50/info/@ver";

        function load() {
            fetching = false;

            // notify the instance of the domain the IDE is loaded on
            domain = window.location.hostname;

            // we only want the domain; e.g., "cs50.io" from "ide.cs50.io"
            if (domain.substring(0, 3) === "ide")
                domain = domain.substring(4);

            // set default values
            settings.on("read", function() {
                settings.setDefaults("user/cs50/info", [
                    ["refreshRate", DEFAULT_REFRESH],
                ]);

                settings.setDefaults("project/cs50/info", [
                    ["public", false]
                ]);
            });

            // watch for settings change and update accordingly
            settings.on("user/cs50/info/@refreshRate", function(rate) {
                if (delay !== rate) {
                    // validate new rate, overwriting bad value if necessary
                    if (isNaN(rate) || rate < 1) {
                        delay = DEFAULT_REFRESH;
                        settings.set("user/cs50/info/@refreshRate", delay);
                    }
                    else {
                        delay = rate;
                    }

                    // update stats and timer interval
                    updateStats();
                    stopTimer();
                    startTimer();
                }
            }, plugin);

            // fetch setting information
            delay = settings.getNumber("user/cs50/info/@refreshRate");

            // create version button
            versionBtn = new ui.button({
                caption: "n/a",
                skin: "c9-menu-btn",
                tooltip: "Version",
                enabled: false
            });

            // place version button
            ui.insertByIndex(layout.findParent({
                name: "preferences"
            }), versionBtn, 500, plugin);

            // cache whether presentation is on initially
            presenting = settings.getBool("user/cs50/presentation/@presenting");

            // set visibility of version number initially
            toggleVersion(!presenting);

            // handle toggling presentation
            settings.on("user/cs50/presentation/@presenting", function(newVal) {
                 // cache setting
                presenting = newVal;

                // toggle visibility of version number
                toggleVersion(!presenting);
            }, plugin);

            // Add preference pane
            prefs.add({
               "CS50" : {
                    position: 5,
                    "IDE Information" : {
                        position: 10,
                        "Information refresh rate (in seconds)" : {
                            type: "spinner",
                            path: "user/cs50/info/@refreshRate",
                            min: 1,
                            max: 200,
                            position: 200
                        }
                    }
                }
            }, plugin);

            // creates new divider and places it after 'About Cloud9'
            var div = new ui.divider();
            menus.addItemByPath("Cloud9/div", div, 100, plugin);

            // creates the "phpMyAdmin" item
            var phpMyAdmin = new ui.item({
                id: "phpmyadmin",
                caption: "phpMyAdmin",
                onclick: openPHPMyAdmin
            });

            // places it in CS50 IDE tab
            menus.addItemByPath("Cloud9/phpMyAdmin", phpMyAdmin, 101, plugin);

            // creates the "Web Server" item
            var webServer = new ui.item({
                id: "websserver",
                caption: "Web Server",
                onclick: displayWebServer
            });

            // places it in CS50 IDE tab
            menus.addItemByPath("Cloud9/Web Server", webServer, 102, plugin);

            // write most recent info50 script
            var ver = settings.getNumber(VERSION_PATH);

            if (isNaN(ver) || ver < INFO_VER) {
                var content = require("text!./bin/info50");
                fetching = true;
                fs.writeFile(BIN + ".info50", content, function(err){
                    if (err) return console.error(err);

                    fs.chmod(BIN + ".info50", permissions, function(err){
                        if (err) return console.error(err);
                        settings.set(VERSION_PATH, INFO_VER);
                        fetching=false;

                        // fetch data
                        updateStats();

                        // always verbose, start timer
                        startTimer();
                    });
                });
            }
            else {
                // fetch data
                updateStats();

                // always verbose, start timer
                startTimer();
            }

            // simplify previewer
            // TODO determine if possible to do for "c9 exec browser" command only
            editors.on("create", function(e) {
                // ensure editor type is "preview"
                var editor = e.editor;
                if (editor.type === "preview") {
                    // hide location bar
                    editor.getElement("locationbar", function(e) {
                        e.setAttribute("visible", false);
                    });

                    // forcibly-hide "Settings" menu as shows back automatically
                    editor.getElement("btnSettings", function(e) {
                        e.$ext.style.display = "none";
                    });

                    editor.getElement("btnPopOut", function(e) {
                        // hide "Reload" button
                        if (e.parentNode && e.parentNode.previousSibling)
                            e.parentNode.previousSibling.setAttribute("visible", false);

                        // shift "Pop Out" button to the right
                        var style = e.getAttribute("style") || "";
                        e.setAttribute("style", "position:absolute;right:0;" + style);
                    });
                }
            });

            // add command to open URL
            commands.addCommand({
                name: "browser",
                exec: function(args) {
                    // ensure URL is given
                    if (!_.isArray(args) || args.length !== 2 || !_.isString(args[1]))
                        return console.log("Usage: c9 exec browser URL");

                    // open URL in built-in browser tab
                    preview.openPreview(args[1], null, true);
                }
            }, plugin);
        }

        /*
         * Opens the web server in a new window/tab
         */
        function displayWebServer() {
            if(!stats || !stats.hasOwnProperty("host")) rewrite();
            window.open("//" +stats.host);
        }

        /*
         * Opens PHP My Admin, logged in, in a new window/tab
         */
        function openPHPMyAdmin() {
            if(!stats || !stats.hasOwnProperty("host")) rewrite();
            var pma = stats.host + '/phpmyadmin';
            window.open("//" + stats.user + ":" + stats.passwd + "@" + pma);
        }

        /*
         * Displays error message and resets version to 0
         */
        function rewrite() {
            console.log(ERROR_TEMP({
                        action: "access",
                        code: permissions,
                        dir: BIN,
                        file: BIN + ".info50"
                    }));
            settings.set(VERSION_PATH, 0);
        }

        /*
         * Stop automatic refresh of information by disabling JS timer
         */
        function stopTimer() {
            if (timer === null)
                return;
            window.clearInterval(timer);
            timer = null;
        }

        /*
         * If not already started, begin a timer to automatically refresh data
         */
        function startTimer() {
            if (timer !== null)
                return;
            timer = window.setInterval(updateStats, delay * 1000);
        }

        /*
         * Updates the shared status (public or private).
         */
        function fetchSharedStatus() {
            api.project.get("", function(err, data) {
                if (err || workspace.myUserId != data.owner.id)
                    return;

                settings.set(
                    "project/cs50/info/@public",
                    data["visibility"] === "public" || data["appAccess"] === "public"
                );
            });
        }

        /*
         * Initiate an info refresh by calling `info50`
         */
        function updateStats(callback) {
            // respect the lock
            if (fetching)
                return;

            fetching = true;

            // check for shared state
            if (c9.hosted)
                fetchSharedStatus();

            // hash that uniquely determines this client
            var myID = workspace.myUserId;
            var myClientID = workspace.myClientId;
            var hash = myID + "-" + myClientID;

            // extra buffer time for info50
            // refer to info50 for more documentation on this
            var buffer = delay + 2;

            proc.execFile(".info50", {
                args: [domain, hash, buffer],
                cwd: BIN
            }, parseStats);
        }

        /*
         * Process output from info50 and update UI with new info
         */
        function parseStats(err, stdout, stderr) {
            // release lock
            fetching = false;

            if (err !== undefined && err !== null) {
                if (err.code === "EDISCONNECT") {
                    // disconnected client: don't provide error
                    return;
                }
                else if (err.code == "ENOENT" || err.code == "EACCES") {
                    rewrite();
                }
                else {
                    settings.set(VERSION_PATH, 0);
                }
                versionBtn.setCaption("n/a");
                return;
            }

            // parse the JSON returned by info50 output
            stats = JSON.parse(stdout);

            // update UI
            versionBtn.setCaption(stats.version);
        }

        /**
         * Toggles visiblity of version number. Forcibly hides version number if
         * presentation is on.
         *
         * @param {boolean} show whether to show or hide version number (has no
         * effect if true and presentation is on)
         */
        function toggleVersion(show) {
            // ensure button was initialized
            if (versionBtn) {
                // forcibly hide while presentation is on or set to hide only
                if (presenting || !show)
                    versionBtn.hide();
                else if (show)
                    versionBtn.show();
            }
        }

        /*
         * Checks if user can preview local server
         */
        function canPreview() {
            if (!c9.hosted)
                return true;

            if (settings.getBool("project/cs50/info/@public"))
                return true;

            // remove port from domain if present
            if (!stats || typeof stats.host !== "string")
                return false;

            var host = stats.host.split(":", 1)[0];

            // host must match, except c9 IDEs must be on c9users domain
            return (domain === "c9.io" && host.endsWith("c9users.io"))
                || host.endsWith(domain);
        }

        /***** Lifecycle *****/

        plugin.on("load", function() {
            load();
        });

        plugin.on("unload", function() {
            stopTimer();

            delay = 30;
            timer = null;
            versionBtn = null;
            fetching = false;
            stats = null;
            domain = null;
            presenting = false;
        });

        /***** Register and define API *****/

        /**
         * This is an example of an implementation of a plugin.
         * @singleton
         */
        plugin.freezePublicAPI({
            /**
             * @property canPreview whether this client can preview
             */
            get canPreview() { return canPreview(); },

            /**
             * @property host
             */
            get host() { return (stats && stats.hasOwnProperty("host")) ? stats.host : null; },

            /**
             * @property hasLoaded whether info50 has run at least once
             */
            get hasLoaded() { return (stats != null); },
        });

        register(null, {
            "harvard.cs50.info": plugin
        });
    }
});
