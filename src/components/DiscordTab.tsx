import { call, toaster } from "@decky/api"
import { Router } from "@decky/ui"
import { useLayoutEffect } from "react"

// Widths of Steam Gamepad UI side menus. Shrinking the BrowserView by these
// amounts keeps Discord visible next to the open side menu instead of
// covering it entirely.
const MAIN_MENU_WIDTH = 400;
const QUICK_ACCESS_WIDTH = 400;

export const DiscordTab = () => {
    useLayoutEffect(() => {
        let sideMenuPoll: number | undefined;
        let lastOpenSide = -1;

        const menuStore: any =
            (Router as any).WindowStore?.GamepadUIMainWindowInstance?.MenuStore;

        const applySideMenuState = (openSide: number) => {
            if (!window.DISCORD_TAB) return;
            if (openSide === lastOpenSide) return;
            lastOpenSide = openSide;
            const tab = window.DISCORD_TAB;
            const W = tab.WIDTH;
            const H = tab.HEIGHT;
            if (openSide === 0) {
                tab.m_browserView.SetBounds(0, 0, W, H);
                tab.m_browserView.SetVisible(true);
                tab.m_browserView.SetFocus(true);
            } else if (openSide === 2) {
                // Quick Access Menu opens from the right — shrink width.
                // Leave focus on the BrowserView so Steam's sidebar doesn't
                // default to focusing its search field.
                tab.m_browserView.SetBounds(0, 0, Math.max(W - QUICK_ACCESS_WIDTH, 0), H);
                tab.m_browserView.SetVisible(true);
            } else {
                // Main menu opens from the left — shift and shrink so the
                // sidebar area is uncovered and Discord remains visible.
                tab.m_browserView.SetBounds(MAIN_MENU_WIDTH, 0, Math.max(W - MAIN_MENU_WIDTH, 0), H);
                tab.m_browserView.SetVisible(true);
            }
        };

        call<[], any>("get_state").then(res => {
            const state = res;
            if (state?.loaded && window.DISCORD_TAB) {
                window.DISCORD_TAB.m_browserView.SetVisible(true);
                window.DISCORD_TAB.m_browserView.SetFocus(true);

                sideMenuPoll = window.setInterval(() => {
                    const openSide = menuStore?.m_eOpenSideMenu ?? 0;
                    applySideMenuState(openSide);
                }, 150);
            }
            else {
                toaster.toast({
                    title: "Deckcord",
                    body: "Deckcord has not loaded yet!"
                });
                Router.Navigate("/library/home");
            }
        })
        return () => {
            if (sideMenuPoll !== undefined) window.clearInterval(sideMenuPoll);
            if (!window.DISCORD_TAB)
                return;

            window.DISCORD_TAB.m_browserView.SetVisible(false);
            window.DISCORD_TAB.m_browserView.SetFocus(false);
        }
    }, [])
    return <div></div>
}