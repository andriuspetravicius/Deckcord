import { call, toaster } from "@decky/api"
import { Router } from "@decky/ui"
import { useLayoutEffect } from "react"

export const DiscordTab = () => {
    useLayoutEffect(() => {
        call<[], any>("get_state").then(res => {
            const state = res;
            if (state?.loaded && window.DISCORD_TAB) {
                const bv = window.DISCORD_TAB.m_browserView;
                bv.SetVisible(true);
                // Place Discord BrowserView below Steam UI so status bar,
                // side menu and Quick Access overlay naturally render on top
                // (with blur) instead of being hidden behind it.
                try { bv.SetWindowStackingOrder?.(0); } catch (_e) { }
                bv.SetFocus(true);
                try { bv.NotifyUserActivation?.(); } catch (_e) { }
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
            if (!window.DISCORD_TAB)
                return;

            window.DISCORD_TAB.m_browserView.SetVisible(false);
            window.DISCORD_TAB.m_browserView.SetFocus(false);
        }
    }, [])
    return <div></div>
}