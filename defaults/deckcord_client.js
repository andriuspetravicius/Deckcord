window.Vencord.Plugins.plugins.Deckcord = {
    name: "Deckcord",
    description: "Plugin required for Deckcord to work",
    authors: [],
    required: true,
    startAt: "DOMContentLoaded",
    async start() {
        window.old_enumerate_devices = navigator.mediaDevices.enumerateDevices
        navigator.mediaDevices.enumerateDevices = async () => {
            const devices = await window.old_enumerate_devices();
            return devices.filter(f => f.label != "Filter Chain Source" && f.label != "Virtual Source" && !(f.label == "" && f.deviceId == "default"))
        }

        navigator.mediaDevices.getUserMedia = (_) => new Promise(async (resolve, reject) => {
            if (window.MIC_STREAM != undefined && window.MIC_PEER_CONNECTION != undefined && window.MIC_PEER_CONNECTION.connectionState == "connected") {
                console.log("WebRTC stream available. Returning that.");
                return resolve(window.MIC_STREAM);
            }

            console.log("Starting WebRTC handshake for mic stream");
            const peerConnection = new RTCPeerConnection(null);
            window.MIC_PEER_CONNECTION = peerConnection;

            window.DECKCORD_WS.addEventListener("message", async (e) => {
                const data = JSON.parse(e.data);
                if (data.type != "$webrtc") return;

                const remoteDescription = new RTCSessionDescription(data.payload);
                await peerConnection.setRemoteDescription(remoteDescription);
            });

            peerConnection.addEventListener("icecandidate", event => {
                if (event.candidate) {
                    window.DECKCORD_WS.send(JSON.stringify({ type: "$MIC_WEBRTC", ice: event.candidate }));
                }
            });

            peerConnection.onaddstream = (ev) => {
                const stream = ev.stream;
                console.log("WEBRTC STREAM", stream);
                window.MIC_STREAM = stream;
                for (const track of stream.getTracks()) {
                    track.stop = () => { console.log("CALLED STOP ON TRACK") }
                    track
                }
                resolve(stream);
            }

            peerConnection.ontrack = (ev) => {
                ev.track.stop = () => { console.log("CALLED STOP ON TRACK") }
            }

            const offer = await peerConnection.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: true });
            await peerConnection.setLocalDescription(offer);
            window.DECKCORD_WS.send(JSON.stringify({ type: "$MIC_WEBRTC", offer: offer }));
        });

        function dataURLtoFile(dataurl, filename) {
            var arr = dataurl.split(','),
                mime = arr[0].match(/:(.*?);/)[1],
                bstr = atob(arr[arr.length - 1]),
                n = bstr.length,
                u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            return new File([u8arr], filename, { type: mime });
        }

        // --- Keyboard management: only open on explicit user tap ---
        // The BrowserView's native virtual keyboard auto-opens whenever
        // an editable element receives focus. Discord auto-focuses the
        // message textbox on every channel/server switch. We MUST blur
        // the element immediately on programmatic focus to prevent
        // the keyboard from appearing. Only allow focus (and thus the
        // native keyboard) when the user physically tapped the screen.
        let _userTapped = false;

        // Mark that the user physically touched/clicked the screen
        document.addEventListener("pointerdown", () => { _userTapped = true; }, true);
        document.addEventListener("touchstart", () => { _userTapped = true; }, true);

        // Reset the flag after a generous delay to cover the full
        // pointerdown -> focus -> keyboard-show event chain
        document.addEventListener("pointerup", () => { setTimeout(() => { _userTapped = false; }, 500); }, true);
        document.addEventListener("touchend", () => { setTimeout(() => { _userTapped = false; }, 500); }, true);

        function attachKeyboardHandler(el) {
            if (el._deckcordPatched) return;
            el._deckcordPatched = true;

            el.addEventListener("focus", (e) => {
                if (_userTapped) {
                    // User explicitly tapped — let the native keyboard show
                    // and also trigger our explicit opener as backup
                    fetch("http://127.0.0.1:65123/openkb", { mode: "no-cors" });
                } else {
                    // Programmatic focus (channel switch, etc.) — immediately
                    // blur to prevent the native virtual keyboard from opening
                    e.target.blur();
                }
            }, true);
        }

        function patchTypingField() {
            const t = setInterval(() => {
                try {
                    const textboxes = document.querySelectorAll("[role=\"textbox\"]");
                    if (textboxes.length > 0) {
                        textboxes.forEach(el => attachKeyboardHandler(el));
                        clearInterval(t);
                    }
                } catch (err) { }
            }, 100);
        }

        // Watch for new textboxes appearing (channel switches, DM opens, etc.)
        const _textboxObserver = new MutationObserver(() => {
            document.querySelectorAll("[role=\"textbox\"]").forEach(el => attachKeyboardHandler(el));
            // Also patch any input elements (search boxes, etc.)
            document.querySelectorAll("input[type=\"text\"], input[type=\"search\"], input:not([type])").forEach(el => attachKeyboardHandler(el));
        });
        // Start observing once the DOM is ready
        const _startObserver = setInterval(() => {
            if (document.body) {
                _textboxObserver.observe(document.body, { childList: true, subtree: true });
                clearInterval(_startObserver);
            }
        }, 200);

        async function getAppId(name) {
            const res = await Vencord.Webpack.Common.RestAPI.get({ url: "/applications/detectable" });
            if (res.ok) {
                const item = res.body.filter(e => e.name == name);
                if (item.length > 0) return item[0].id;
            }
            return "0";
        }

        // --- Inject Deckcord CSS: narrower sidebar, wider chat ---
        function injectDeckcordCSS() {
            const style = document.createElement('style');
            style.id = 'deckcord-custom-css';
            style.textContent = `
                /* Narrow the guild sidebar (server icon strip) */
                nav[aria-label="Servers sidebar"],
                div[class*="guilds_"] {
                    width: 56px !important;
                    min-width: 56px !important;
                }

                /* Narrow the channel sidebar (~20% less than default 240px) */
                div[class*="sidebar_"] {
                    width: 190px !important;
                    min-width: 190px !important;
                    max-width: 190px !important;
                }

                /* Force the entire app base layout to give chat maximum space */
                div[class*="base_"] {
                    display: flex !important;
                    flex: 1 1 0% !important;
                    min-width: 0 !important;
                    overflow: hidden !important;
                }

                /* Chat container — fill ALL remaining horizontal space */
                div[class*="chat_"] {
                    flex: 1 1 0% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                    width: 0 !important;
                }
                div[class*="chatContent_"] {
                    flex: 1 1 0% !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }

                /* Ensure the content wrapper also stretches */
                div[class*="content_"][class*="container_"] {
                    flex: 1 1 0% !important;
                    min-width: 0 !important;
                }
            `;
            const injectInterval = setInterval(() => {
                if (document.head) {
                    // Remove any existing to avoid duplicates on reconnect
                    const existing = document.getElementById('deckcord-custom-css');
                    if (existing) existing.remove();
                    document.head.appendChild(style);
                    clearInterval(injectInterval);
                }
            }, 200);
        }
        injectDeckcordCSS();

        // --- File upload: intercept and use backend native file picker ---
        // BrowserView does NOT support native <input type="file"> dialogs.
        // We intercept file input clicks, ask the backend to show a
        // native file picker (kdialog), and inject the selected file
        // back into Discord's upload mechanism via DataTransfer.
        window._pendingFileInput = null;

        function patchFileUpload() {
            const observer = new MutationObserver(() => {
                document.querySelectorAll('input[type="file"]').forEach(input => {
                    if (input._deckcordFilePatched) return;
                    input._deckcordFilePatched = true;

                    input.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        // Store reference so we can inject the file later
                        window._pendingFileInput = input;

                        // Ask backend to open native file picker
                        if (window.DECKCORD_WS && window.DECKCORD_WS.readyState === WebSocket.OPEN) {
                            window.DECKCORD_WS.send(JSON.stringify({
                                type: "$file_picker",
                                accept: input.accept || "*/*",
                                multiple: input.multiple || false
                            }));
                            console.log("Deckcord: Requested native file picker from backend");
                        } else {
                            console.warn("Deckcord: WebSocket not connected, cannot open file picker");
                        }
                    }, true);
                });
            });
            const startObs = setInterval(() => {
                if (document.body) {
                    observer.observe(document.body, { childList: true, subtree: true });
                    clearInterval(startObs);
                }
            }, 200);
        }
        patchFileUpload();

        let CloudUpload;
        CloudUpload = Vencord.Webpack.findLazy(m => m.prototype?.trackUploadFinished);;
        function sendAttachmentToChannel(channelId, attachment_b64, filename) {
            return new Promise((resolve, reject) => {
                const file = dataURLtoFile(`data:text/plain;base64,${attachment_b64}`, filename);
                const upload = new CloudUpload({
                    file: file,
                    isClip: false,
                    isThumbnail: false,
                    platform: 1,
                }, channelId, false, 0);
                upload.on("complete", () => {
                    Vencord.Webpack.Common.RestAPI.post({
                        url: `/channels/${channelId}/messages`,
                        body: {
                            channel_id: channelId,
                            content: "",
                            nonce: Vencord.Webpack.Common.SnowflakeUtils.fromTimestamp(Date.now()),
                            sticker_ids: [],
                            type: 0,
                            attachments: [{
                                id: "0",
                                filename: upload.filename,
                                uploaded_filename: upload.uploadedFilename
                            }]
                        }
                    });
                    resolve(true);
                });
                upload.on("error", () => resolve(false))
                upload.upload();
            })
        }

        let MediaEngineStore, FluxDispatcher;
        console.log("Deckcord: Waiting for FluxDispatcher...");
        Vencord.Webpack.waitFor(["subscribe", "dispatch", "register"], fdm => {
            FluxDispatcher = fdm;
            Vencord.Webpack.waitFor(Vencord.Webpack.filters.byStoreName("MediaEngineStore"), m => {
                MediaEngineStore = m;
                FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_AUDIO_ENABLED", enabled: true, unmute: true });
            });

            function connect() {
                window.DECKCORD_WS = new WebSocket('ws://127.0.0.1:65123/socket');
                window.DECKCORD_WS.addEventListener("message", async function (e) {
                    const data = JSON.parse(e.data);
                    if (data.type.startsWith("$")) {
                        let result;
                        try {
                            switch (data.type) {
                                case "$getuser":
                                    result = Vencord.Webpack.Common.UserStore.getUser(data.id);
                                    break;
                                case "$getchannel":
                                    result = Vencord.Webpack.Common.ChannelStore.getChannel(data.id);
                                    break;
                                case "$getguild":
                                    result = Vencord.Webpack.Common.GuildStore.getGuild(data.id);
                                    break;
                                case "$getmedia":
                                    result = {
                                        mute: MediaEngineStore.isSelfMute(),
                                        deaf: MediaEngineStore.isSelfDeaf(),
                                        live: MediaEngineStore.getGoLiveSource() != undefined
                                    }
                                    break;
                                case "$get_last_channels":
                                    result = {}
                                    const ChannelStore = Vencord.Webpack.Common.ChannelStore;
                                    const GuildStore = Vencord.Webpack.Common.GuildStore;
                                    const channelIds = Object.values(JSON.parse(Vencord.Util.localStorage.SelectedChannelStore).mostRecentSelectedTextChannelIds);
                                    for (const chId of channelIds) {
                                        const ch = ChannelStore.getChannel(chId);
                                        const guild = GuildStore.getGuild(ch.guild_id);
                                        result[chId] = `${ch.name} (${guild.name})`;
                                    }
                                    break;
                                case "$get_screen_bounds":
                                    result = { width: screen.width, height: screen.height }
                                    break;
                                case "$ptt":
                                    try {
                                        MediaEngineStore.getMediaEngine().connections.values().next().value.setForceAudioInput(data.value);
                                    } catch (error) { }
                                    return;
                                case "$setptt":
                                    FluxDispatcher.dispatch({
                                        "type": "AUDIO_SET_MODE",
                                        "context": "default",
                                        "mode": data.enabled ? "PUSH_TO_TALK" : "VOICE_ACTIVITY",
                                        "options": MediaEngineStore.getSettings().modeOptions
                                    });
                                    return;
                                case "$rpc":
                                    FluxDispatcher.dispatch({
                                        type: "LOCAL_ACTIVITY_UPDATE",
                                        activity: data.game ? {
                                            application_id: await getAppId(data.game),
                                            name: data.game,
                                            type: 0,
                                            flags: 1,
                                            timestamps: { start: Date.now() }
                                        } : {},
                                        socketId: "CustomRPC",
                                    });
                                    return;
                                case "$screenshot":
                                    result = await sendAttachmentToChannel(data.channel_id, data.attachment_b64, "screenshot.jpg");
                                    break;
                                case "$golive":
                                    const vc_channel_id = Vencord.Webpack.findStore("SelectedChannelStore").getVoiceChannelId();
                                    if (!vc_channel_id) return;
                                    const vc_guild_id = Vencord.Webpack.Common.ChannelStore.getChannel(vc_channel_id).guild_id;
                                    try {
                                        const streamMod = Vencord.Webpack.findByProps("startStream", "stopStream");
                                        if (streamMod) {
                                            if (data.stop) streamMod.stopStream(null, null, null);
                                            else streamMod.startStream(vc_guild_id, vc_channel_id, "Activity Panel");
                                        } else {
                                            console.warn("Deckcord: Could not find stream module via findByProps");
                                        }
                                    } catch(e) {
                                        console.error("Deckcord: Go Live error:", e);
                                    }
                                    return;
                                case "$webrtc":
                                    return;
                                case "$file_picker_result":
                                    // Backend sent back the selected file(s) from native picker
                                    if (window._pendingFileInput && data.files && data.files.length > 0) {
                                        try {
                                            const dt = new DataTransfer();
                                            for (const f of data.files) {
                                                const bstr = atob(f.data);
                                                const u8 = new Uint8Array(bstr.length);
                                                for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
                                                dt.items.add(new File([u8], f.name, { type: f.type || 'application/octet-stream' }));
                                            }
                                            window._pendingFileInput.files = dt.files;
                                            window._pendingFileInput.dispatchEvent(new Event('change', { bubbles: true }));
                                            console.log("Deckcord: Injected " + data.files.length + " file(s) into upload input");
                                        } catch(err) {
                                            console.error("Deckcord: Failed to inject files:", err);
                                        }
                                        window._pendingFileInput = null;
                                    } else {
                                        // User cancelled or no files
                                        window._pendingFileInput = null;
                                    }
                                    return
                            }
                        } catch (error) {
                            result = { error: error }
                            if (data.increment == undefined) return;
                        }
                        const payload = {
                            type: "$deckcord_request",
                            increment: data.increment,
                            result: result || {}
                        };
                        console.debug(data, payload);
                        window.DECKCORD_WS.send(JSON.stringify(payload));
                        return;
                    }
                    FluxDispatcher.dispatch(data);
                });

                window.DECKCORD_WS.onopen = function (e) {
                    navigator.mediaDevices.getUserMedia();
                    Vencord.Webpack.waitFor("useState", t =>
                        window.DECKCORD_WS.send(JSON.stringify({
                            type: "LOADED",
                            result: true
                        }))
                    );
                }

                window.DECKCORD_WS.onclose = function (e) {
                    FluxDispatcher._interceptors.pop()
                    setTimeout(function () {
                        connect();
                    }, 100);
                };

                window.DECKCORD_WS.onerror = function (err) {
                    console.error('Socket encountered error: ', err.message, 'Closing socket');
                    window.DECKCORD_WS.close();
                };

                Vencord.Webpack.onceReady.then(t =>
                    window.DECKCORD_WS.send(JSON.stringify({
                        type: "CONNECTION_OPEN",
                        user: Vencord.Webpack.Common.UserStore.getCurrentUser()
                    }))
                );

                FluxDispatcher.addInterceptor(e => {
                    if (e.type == "CHANNEL_SELECT") patchTypingField();
                    const shouldPass = [
                        "CONNECTION_OPEN",
                        "LOGOUT",
                        "CONNECTION_CLOSED",
                        "VOICE_STATE_UPDATES",
                        "VOICE_CHANNEL_SELECT",
                        "AUDIO_TOGGLE_SELF_MUTE",
                        "AUDIO_TOGGLE_SELF_DEAF",
                        "RPC_NOTIFICATION_CREATE",
                        "STREAM_START",
                        "STREAM_STOP"
                    ].includes(e.type);
                    if (shouldPass) {
                        console.log("Dispatching Deckcord event: ", e);
                        window.DECKCORD_WS.send(JSON.stringify(e));
                    }
                });
                console.log("Deckcord: Added event interceptor");
            }
            connect();
        });

        (() => {
            const t = setInterval(() => {
                try {
                    if (window.location.pathname == "/login") {
                        for (const el of document.getElementsByTagName('input')) {
                            attachKeyboardHandler(el);
                        }
                    }
                    clearInterval(t);
                }
                catch (err) { }
            }, 100)
        })();
    }
};