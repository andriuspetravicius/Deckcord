from pathlib import Path

from aiohttp import ClientSession  # type: ignore
from .cdp import Tab, get_tab_lambda
from asyncio import sleep
from ssl import create_default_context

from decky import logger  # type: ignore


async def find_discord_tab() -> Tab:
    """
    Finds the Discord browser view tab via CDP.
    The tab is created by the frontend (index.tsx) using Router.WindowStore,
    and loads a sentinel URL so we can identify it here.
    """
    max_attempts = 30  # 30 * 1s = 30s max wait
    for attempt in range(max_attempts):
        try:
            discord_tab = await get_tab_lambda(
                lambda tab: tab.url == "data:text/plain,to_be_discord"
            )
            if discord_tab:
                logger.info(
                    f"Found Discord tab via CDP on attempt {attempt + 1}"
                )
                return discord_tab
        except Exception:
            pass

        await sleep(1)

    raise RuntimeError(
        "Could not find Discord browser view tab via CDP after 30 attempts. "
        "The frontend may have failed to create it."
    )


async def fetch_vencord() -> str:
    async with ClientSession() as session:
        res = await session.get(
            "https://raw.githubusercontent.com/Vencord/builds/main/browser.js",
            ssl=create_default_context(cafile="/etc/ssl/cert.pem"),
        )

        if res.ok:
            return await res.text()

    return ""


async def setup_discord_tab(tab: Tab) -> None:
    await tab.open_websocket()
    await tab.enable()
    await tab._send_devtools_cmd(
        {
            "method": "Page.addScriptToEvaluateOnNewDocument",
            "params": {
                "source": "Object.hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);"
                + await fetch_vencord()
                + open(
                    Path(__file__).parent.parent.joinpath("deckcord_client.js"),
                    "r",
                ).read()
                + open(
                    Path(__file__).parent.parent.joinpath("webrtc_client.js"),
                    "r",
                ).read(),
                "runImmediately": True,
            },
        }
    )


async def boot_discord(tab: Tab) -> None:
    await tab._send_devtools_cmd(
        {
            "method": "Page.navigate",
            "params": {
                "url": "https://discord.com/app",
                "transitionType": "address_bar",
            },
        }
    )


async def setOSK(tab: Tab, state: bool) -> None:
    if state:
        await tab.evaluate(
            "DISCORD_TAB.m_virtualKeyboardHost.m_showKeyboard()"
        )
    else:
        await tab.evaluate(
            "DISCORD_TAB.m_virtualKeyboardHost.m_hideKeyboard()"
        )
