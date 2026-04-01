from pathlib import Path

from aiohttp import ClientSession  # type: ignore
from .cdp import Tab, get_tab, get_tab_lambda
from asyncio import sleep
from ssl import create_default_context

async def create_discord_tab():
    while True:
        try:
            tab = await get_tab("SharedJSContext")
            break

        except:
            await sleep(0.1)

    await tab.open_websocket()

    while True:
        await tab.evaluate("""
                    if (window.DISCORD_TAB !== undefined) {
                        window.DISCORD_TAB.m_browserView.SetVisible(false);
                        window.DISCORD_TAB.Destroy();
                        window.DISCORD_TAB = undefined;
                    }

                    // Find the main window instance - try multiple access paths for SteamOS compatibility
                    var _mainWindow = null;
                    if (typeof SteamUIStore !== 'undefined' && SteamUIStore.WindowStore) {
                        _mainWindow = SteamUIStore.WindowStore.GamepadUIMainWindowInstance;
                    }
                    if (!_mainWindow && typeof Router !== 'undefined' && Router.WindowStore) {
                        _mainWindow = Router.WindowStore.GamepadUIMainWindowInstance;
                    }
                    if (!_mainWindow) {
                        // Fallback: iterate window properties to find WindowStore
                        for (var key in window) {
                            try {
                                if (window[key] && window[key].WindowStore && window[key].WindowStore.GamepadUIMainWindowInstance) {
                                    _mainWindow = window[key].WindowStore.GamepadUIMainWindowInstance;
                                    break;
                                }
                            } catch(e) {}
                        }
                    }

                    if (_mainWindow) {
                        window.DISCORD_TAB = _mainWindow.CreateBrowserView("discord");
                        window.DISCORD_TAB.WIDTH = 860;
                        window.DISCORD_TAB.HEIGHT = 495;
                        window.DISCORD_TAB.m_browserView.SetBounds(0, 0, window.DISCORD_TAB.WIDTH, window.DISCORD_TAB.HEIGHT);
                        window.DISCORD_TAB.m_browserView.LoadURL("data:text/plain,to_be_discord");

                        // Register keyboard overlay handler
                        try {
                            _mainWindow.m_VirtualKeyboardManager.IsShowingVirtualKeyboard.m_callbacks.m_vecCallbacks.push((e) => {
                                if (!e) {
                                    const bounds = window.DISCORD_TAB.m_browserView.GetBounds();
                                    if (bounds.height != window.DISCORD_TAB.HEIGHT) {
                                        window.DISCORD_TAB.m_browserView.SetBounds(0, 0, window.DISCORD_TAB.WIDTH, window.DISCORD_TAB.HEIGHT);
                                    }
                                }
                                else {
                                    const bounds = window.DISCORD_TAB.m_browserView.GetBounds();
                                    if (bounds.height != window.DISCORD_TAB.HEIGHT * 0.6) {
                                        window.DISCORD_TAB.m_browserView.SetBounds(0, 0, window.DISCORD_TAB.WIDTH, window.DISCORD_TAB.HEIGHT * 0.6);
                                    }
                                }
                            });
                        } catch(e) {
                            console.warn("Deckcord: Could not register virtual keyboard handler:", e);
                        }
                    } else {
                        console.error("Deckcord: Could not find GamepadUIMainWindowInstance");
                    }
        """)
        await sleep(3)

        try:
            discord_tab = await get_tab_lambda(lambda tab: tab.url == "data:text/plain,to_be_discord")

            if discord_tab:
                await tab.close_websocket()
                return discord_tab

        except:
            pass


async def fetch_vencord() -> str:
    async with ClientSession() as session:
        res = await session.get("https://raw.githubusercontent.com/Vencord/builds/main/browser.js",
                                ssl=create_default_context(cafile="/etc/ssl/cert.pem"))

        if res.ok:
            return await res.text()

    return ""


async def setup_discord_tab(tab: Tab) -> None:
    await tab.open_websocket()
    await tab.enable()
    await tab._send_devtools_cmd({
        "method": "Page.addScriptToEvaluateOnNewDocument",
        "params": {
            "source":
                "Object.hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);" +
                await fetch_vencord() +
                open(Path(__file__).parent.parent.joinpath("deckcord_client.js"), "r").read() +
                open(Path(__file__).parent.parent.joinpath("webrtc_client.js"), "r").read(),
            "runImmediately": True
        }
    })


async def boot_discord(tab: Tab) -> None:
    await tab._send_devtools_cmd({
        "method": "Page.navigate",
        "params": {
            "url": "https://discord.com/app",
            "transitionType": "address_bar"
        }
    })


async def setOSK(tab: Tab, state: bool) -> None:
    if state:
        await tab.evaluate("DISCORD_TAB.m_virtualKeyboardHost.m_showKeyboard()")
    else:
        await tab.evaluate("DISCORD_TAB.m_virtualKeyboardHost.m_hideKeyboard()")
