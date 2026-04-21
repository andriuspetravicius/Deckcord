import { call, toaster } from "@decky/api"
import { Router } from "@decky/ui"
import { useLayoutEffect } from "react"

export const DiscordTab = () => {
    useLayoutEffect(() => {
        let sideMenuPoll: number | undefined;
        let lastVisible = true;

        const menuStore: any =
            (Router as any).WindowStore?.GamepadUIMainWindowInstance?.MenuStore;

        const applyVisibility = (visible: boolean) => {
            if (!window.DISCORD_TAB) return;
            if (visible === lastVisible) return;
            lastVisible = visible;
            window.DISCORD_TAB.m_browserView.SetVisible(visible);
            window.DISCORD_TAB.m_browserView.SetFocus(visible);
        };

        call<[], any>("get_state").then(res => {
            const state = res;
            if (state?.loaded && window.DISCORD_TAB) {
                window.DISCORD_TAB.m_browserView.SetVisible(true);
                window.DISCORD_TAB.m_browserView.SetFocus(true);

                // Hide BrowserView when Steam side menu (main/quick access) is open,
                // otherwise it covers the Steam UI chrome.
                sideMenuPoll = window.setInterval(() => {
                    const open = (menuStore?.m_eOpenSideMenu ?? 0) !== 0;
                    applyVisibility(!open);
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