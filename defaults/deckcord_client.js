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

        // --- Keyboard management: target-aware + active element tracking ---
        // Problem 1: When user taps a channel name, Discord auto-focuses
        // the textbox. Must distinguish user-tapped-textbox from auto-focus.
        // Problem 2: While typing, Discord's React re-renders may cause
        // focus cycles. Must not close keyboard during active typing.
        //
        // Solution: Track _tappedTarget (what was tapped) AND
        // _activeEditableElement (the element user intentionally focused).
        // Once focused intentionally, always allow re-focus on that same
        // element until user taps a non-editable area.
        let _tappedTarget = null;
        let _activeEditableElement = null;

        document.addEventListener("pointerdown", (e) => {
            _tappedTarget = e.target;
            const tappedEditable = _findEditableParent(e.target);
            if (tappedEditable) {
                _activeEditableElement = tappedEditable;
                // Re-open keyboard if tapping already-focused input
                if (document.activeElement === tappedEditable) {
                    fetch("http://127.0.0.1:65123/openkb", { mode: "no-cors" });
                }
            } else {
                // Tapped non-editable area — clear active element
                _activeEditableElement = null;
            }
        }, true);
        document.addEventListener("touchstart", (e) => {
            const target = e.touches[0]?.target || e.target;
            _tappedTarget = target;
            const tappedEditable = _findEditableParent(target);
            if (tappedEditable) {
                _activeEditableElement = tappedEditable;
                if (document.activeElement === tappedEditable) {
                    fetch("http://127.0.0.1:65123/openkb", { mode: "no-cors" });
                }
            } else {
                _activeEditableElement = null;
            }
        }, true);
        document.addEventListener("pointerup", () => { setTimeout(() => { _tappedTarget = null; }, 1000); }, true);
        document.addEventListener("touchend", () => { setTimeout(() => { _tappedTarget = null; }, 1000); }, true);

        function _isEditable(el) {
            if (!el || !el.tagName) return false;
            return (
                (el.getAttribute && el.getAttribute("role") === "textbox") ||
                el.isContentEditable ||
                (el.tagName === "INPUT" && !["hidden", "file", "checkbox", "radio", "button", "submit", "reset"].includes(el.type)) ||
                el.tagName === "TEXTAREA"
            );
        }

        function _findEditableParent(el) {
            let node = el;
            while (node) {
                if (_isEditable(node)) return node;
                node = node.parentElement;
            }
            return null;
        }

        function _shouldAllowFocus(el) {
            // Allow if user tapped directly inside this element
            if (_tappedTarget && (el === _tappedTarget || el.contains(_tappedTarget))) return true;
            // Allow if this is the element user previously intentionally focused
            if (el === _activeEditableElement) return true;
            return false;
        }

        // Override HTMLElement.prototype.focus — block programmatic focus
        const _origFocus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function(options) {
            if (_isEditable(this) && !_shouldAllowFocus(this)) {
                return; // Block focus entirely
            }
            return _origFocus.call(this, options);
        };

        // Backup: global focusin for any focus that bypasses .focus()
        document.addEventListener("focusin", (e) => {
            if (_isEditable(e.target) && !_shouldAllowFocus(e.target)) {
                e.target.blur();
            }
        }, true);

        async function getAppId(name) {
            const res = await Vencord.Webpack.Common.RestAPI.get({ url: "/applications/detectable" });
            if (res.ok) {
                const item = res.body.filter(e => e.name == name);
                if (item.length > 0) return item[0].id;
            }
            return "0";
        }

        // --- Layout: JS-based style injection ---
        // CSS attribute selectors ([class*="..."]) fail to match Discord's
        // hashed class names reliably. Instead, we iterate DOM elements
        // and apply styles directly using element.style.setProperty().
        // Runs on an interval to handle Discord re-renders.
        function applyDeckcordLayout() {
            setInterval(() => {
                try {
                    // Guild sidebar (server icon strip)
                    const guildNav = document.querySelector('nav[aria-label="Servers sidebar"]');
                    if (guildNav) {
                        guildNav.style.setProperty('width', '62px', 'important');
                        guildNav.style.setProperty('min-width', '62px', 'important');
                    }

                    // Channel sidebar + chat: find by className.includes()
                    document.querySelectorAll('div, nav').forEach(el => {
                        const cls = el.className;
                        if (typeof cls !== 'string') return;

                        // Channel sidebar container
                        if (cls.includes('sidebar') && !cls.includes('guilds') && el.querySelector('ul, [class*="channel"]')) {
                            el.style.setProperty('width', '210px', 'important');
                            el.style.setProperty('min-width', '210px', 'important');
                            el.style.setProperty('max-width', '210px', 'important');
                        }

                        // Chat content area
                        if (cls.includes('chatContent')) {
                            el.style.setProperty('max-width', 'none', 'important');
                            el.style.setProperty('flex', '1 1 0%', 'important');
                        }

                        // Messages wrapper
                        if (cls.includes('messagesWrapper')) {
                            el.style.setProperty('max-width', 'none', 'important');
                        }

                        // The chat panel itself (parent of chatContent)
                        if (cls.includes('chat') && !cls.includes('chatContent') && !cls.includes('sidebar') && el.querySelector('[class*="chatContent"]')) {
                            el.style.setProperty('flex', '1 1 0%', 'important');
                            el.style.setProperty('max-width', 'none', 'important');
                            el.style.setProperty('min-width', '0', 'important');
                        }
                    });
                } catch(e) {}
            }, 1000);
        }
        applyDeckcordLayout();

        // --- File upload: in-BrowserView file picker ---
        // Native file dialogs don't work in BrowserView/Game Mode.
        // Instead we render a custom file picker overlay inside Discord.
        // Flow: intercept file input → show overlay → user browses
        // filesystem via backend WS → selects file → backend reads
        // as base64 → inject into Discord upload.
        window._pendingFileInput = null;

        function _showFilePicker() {
            const existing = document.getElementById('deckcord-file-picker');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'deckcord-file-picker';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.92);z-index:999999;display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif;color:#dcddde;';
            overlay.innerHTML = `
                <div style="display:flex;align-items:center;padding:10px 16px;background:#1e1f22;border-bottom:1px solid #3f4147;gap:8px;">
                    <button id="dcfp-back" style="background:none;border:none;color:#b5bac1;font-size:22px;cursor:pointer;padding:4px 8px;">←</button>
                    <span id="dcfp-path" style="flex:1;font-size:13px;color:#b5bac1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Select a file to upload</span>
                    <button id="dcfp-close" style="background:#ed4245;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">Cancel</button>
                </div>
                <div id="dcfp-list" style="flex:1;overflow-y:auto;padding:4px 8px;"></div>
            `;
            document.body.appendChild(overlay);

            document.getElementById('dcfp-close').addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                overlay.remove();
            });
            document.getElementById('dcfp-back').addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                const parent = overlay.dataset.parent || '';
                _requestFileList(parent);
            });

            _requestFileList('');
        }

        function _requestFileList(path) {
            if (window.DECKCORD_WS && window.DECKCORD_WS.readyState === WebSocket.OPEN) {
                window.DECKCORD_WS.send(JSON.stringify({ type: "$file_picker", path: path }));
            }
        }

        function _populateFileList(data) {
            const overlay = document.getElementById('deckcord-file-picker');
            if (!overlay) return;

            overlay.dataset.parent = data.parent || '';
            document.getElementById('dcfp-path').textContent = data.path || 'Select a location';

            const list = document.getElementById('dcfp-list');
            list.innerHTML = '';

            if (data.error) {
                const errDiv = document.createElement('div');
                errDiv.style.cssText = 'padding:20px;color:#ed4245;text-align:center;';
                errDiv.textContent = data.error;
                list.appendChild(errDiv);
                return;
            }

            for (const entry of data.entries) {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex;align-items:center;padding:12px;border-radius:6px;cursor:pointer;gap:12px;margin:2px 0;';

                const isImage = entry.mime && entry.mime.startsWith('image/');
                const icon = entry.type === 'directory' ? '📁' : (isImage ? '🖼️' : '📄');
                const sizeStr = entry.size ? (entry.size > 1048576 ? (entry.size / 1048576).toFixed(1) + ' MB' : (entry.size / 1024).toFixed(0) + ' KB') : '';

                // Use DOM API instead of innerHTML to prevent XSS from filenames
                const iconSpan = document.createElement('span');
                iconSpan.style.cssText = 'font-size:22px;width:30px;text-align:center;flex-shrink:0;';
                iconSpan.textContent = icon;
                item.appendChild(iconSpan);

                const nameSpan = document.createElement('span');
                nameSpan.style.cssText = 'flex:1;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                nameSpan.textContent = entry.name;
                item.appendChild(nameSpan);

                if (sizeStr) {
                    const sizeSpan = document.createElement('span');
                    sizeSpan.style.cssText = 'font-size:12px;color:#72767d;flex-shrink:0;';
                    sizeSpan.textContent = sizeStr;
                    item.appendChild(sizeSpan);
                }

                item.addEventListener('pointerenter', () => { item.style.background = '#2b2d31'; });
                item.addEventListener('pointerleave', () => { item.style.background = ''; });

                const entryPath = entry.path;
                const entryType = entry.type;
                item.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    if (entryType === 'directory') {
                        _requestFileList(entryPath);
                    } else {
                        _selectFile(entryPath);
                    }
                });

                list.appendChild(item);
            }

            if (data.entries.length === 0) {
                list.innerHTML = '<div style="padding:30px;color:#72767d;text-align:center;font-size:14px;">Empty folder</div>';
            }
        }

        function _selectFile(filepath) {
            const list = document.getElementById('dcfp-list');
            if (list) {
                list.innerHTML = '<div style="padding:40px;text-align:center;color:#b5bac1;font-size:15px;">⏳ Loading file...</div>';
            }
            if (window.DECKCORD_WS && window.DECKCORD_WS.readyState === WebSocket.OPEN) {
                window.DECKCORD_WS.send(JSON.stringify({ type: "$file_picker_select", path: filepath }));
            }
        }

        function _interceptFileInput(input) {
            window._pendingFileInput = input;
            _showFilePicker();
            console.log("Deckcord: Showing in-BrowserView file picker");
        }

        // Layer 1: Prototype-level click override
        const _origInputClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function() {
            if (this.type === 'file') {
                _interceptFileInput(this);
                return;
            }
            return _origInputClick.call(this);
        };

        // Layer 2: Hook createElement to patch file inputs at creation
        const _origCreateElement = document.createElement.bind(document);
        document.createElement = function(tagName, options) {
            const el = _origCreateElement(tagName, options);
            if (tagName.toLowerCase() === 'input') {
                const _origElClick = el.click.bind(el);
                el.click = function() {
                    if (el.type === 'file') {
                        _interceptFileInput(el);
                        return;
                    }
                    return _origElClick();
                };
            }
            return el;
        };

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

            let reconnectDelayMs = 250;
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
                                case "$file_picker_list":
                                    _populateFileList(data);
                                    return;
                                case "$file_picker_result":
                                    // Close the file picker overlay
                                    const fpOverlay = document.getElementById('deckcord-file-picker');
                                    if (fpOverlay) fpOverlay.remove();
                                    // Inject file(s) into Discord's upload input
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
                                    }
                                    window._pendingFileInput = null;
                                    return;
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
                    reconnectDelayMs = 250;
                    navigator.mediaDevices.getUserMedia();
                    Vencord.Webpack.waitFor("useState", t =>
                        window.DECKCORD_WS.send(JSON.stringify({
                            type: "LOADED",
                            result: true
                        }))
                    );
                }

                window.DECKCORD_WS.onclose = function (e) {
                    const delay = reconnectDelayMs;
                    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5000);
                    setTimeout(function () {
                        connect();
                    }, delay);
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

            }

            // Add interceptor ONCE — reconnects reuse the same one.
            // Previously re-added on every connect() causing duplicate events.
            if (!window.__DECKCORD_INTERCEPTOR_ADDED) {
                window.__DECKCORD_INTERCEPTOR_ADDED = true;
                FluxDispatcher.addInterceptor(e => {
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
                    if (shouldPass && window.DECKCORD_WS && window.DECKCORD_WS.readyState === 1) {
                        console.log("Dispatching Deckcord event: ", e);
                        window.DECKCORD_WS.send(JSON.stringify(e));
                    }
                });
                console.log("Deckcord: Added event interceptor");
            }
            connect();
        });
    }
};
