//Credit: https://github.com/jessebofill/DeckWebBrowser

import { afterPatch, findInReactTree, getGamepadNavigationTrees, getReactInstance, getReactRoot, Navigation, Router } from "@decky/ui"
import { FC, ReactElement, ReactNode } from "react"
import { FaDiscord } from "react-icons/fa"

interface MainMenuItemPropsBase {
    route: string
    label: ReactNode
    onFocus?: () => void
    onGamepadFocus?: () => void
    icon?: ReactElement
    onActivate?: () => void
}

type MainMenuItemProps = MainMenuItemPropsBase & Record<string, any>;

const getReactTree = () => {
    const mainMenuElement = getGamepadNavigationTrees()
        ?.find((tree: any) => tree.m_ID === 'MainNavMenuContainer')
        ?.Root?.Element

    return (
        (mainMenuElement ? getReactInstance(mainMenuElement) : undefined) ||
        getReactRoot(document.getElementById('root') as any)
    )
}

export const patchMenu = () => {
    let unpatch = () => { }
    const uninstallDomFallback = installDomMenuFallback()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const tryPatch = () => {
        if (disposed) return

        const nextUnpatch = patchMenuOnce()
        if (nextUnpatch) {
            unpatch = nextUnpatch
            return
        }

        retryTimer = setTimeout(tryPatch, 1000)
    }

    tryPatch()

    return () => {
        disposed = true
        if (retryTimer) clearTimeout(retryTimer)
        unpatch()
        uninstallDomFallback()
    }
}

const patchMenuOnce = () => {
    const menuNode = findMainMenuNode()
    if (!menuNode || !menuNode.return?.type) {
        console.log('Failed to find main menu root node.')
        return undefined
    }
    const orig = menuNode.return.type
    const menuWrapper = (props: any) => {
        const ret = orig(props)
        patchMenuItems(ret)
        patchNestedMenuRenderers(ret)
        return ret
    }
    menuNode.return.type = menuWrapper
    if (menuNode.return.alternate) {
        menuNode.return.alternate.type = menuNode.return.type;
    }

    return () => {
        if (menuNode.return) {
            menuNode.return.type = orig
            if (menuNode.return.alternate) {
                menuNode.return.alternate.type = menuNode.return.type;
            }
        }
    }
}

function findMainMenuNode() {
    const tree = getReactTree()
    let menuNode = findInReactTree(tree, (node: { memoizedProps: { navID: string } }) => node?.memoizedProps?.navID == 'MainNavMenuContainer')

    let current = tree
    while (current) {
        if (current?.memoizedProps?.navID === 'MainNavMenuContainer') {
            menuNode = current
        }
        current = current.return
    }

    return menuNode
}

const isMenuItemElt = (e: any) => e?.props?.label && (e.props.onFocus || e.props.onGamepadFocus) && e.props.route && e.type?.toString;

function patchMenuItems(ret: any) {
    const menuItems = findInReactTree(ret, (node: any[]) => Array.isArray(node) && node.some(isMenuItemElt)) as Array<any>;

    if (!menuItems || menuItems.some((item) => item?.props?.route === '/discord')) {
        return false
    }

    const itemIndexes = getMenuItemIndexes(menuItems);
    const menuItem = menuItems.find(isMenuItemElt) as { props: MainMenuItemProps, type: () => ReactElement };
    const focusProps = menuItem.props.onGamepadFocus
        ? { onGamepadFocus: menuItem.props.onGamepadFocus }
        : { onFocus: menuItem.props.onFocus };

    const newItem =
        <MenuItemWrapper
            key={'deckcord'}
            route={'/discord'}
            label='Discord'
            {...focusProps}
            useIconAsProp={!!menuItem.props.icon}
            MenuItemComponent={menuItem.type}
        />

    const browserPosition = Number.parseInt(localStorage.getItem("DECKCORD_MENU_POSITION") || "3" as string);

    if (browserPosition === 9) menuItems.splice(itemIndexes[itemIndexes.length - 1] + 1, 0, newItem)
    else menuItems.splice(itemIndexes[browserPosition - 1], 0, newItem)

    return true
}

function patchNestedMenuRenderers(node: any, depth = 0) {
    if (!node || depth > 8) return

    if (Array.isArray(node)) {
        node.forEach((child) => patchNestedMenuRenderers(child, depth + 1))
        return
    }

    if (node?.props?.children) {
        patchNestedMenuRenderers(node.props.children, depth + 1)
    }

    if (typeof node?.type === 'function' && !node.__deckcordMenuRendererPatched) {
        node.__deckcordMenuRendererPatched = true
        afterPatch(node, 'type', (_: any, childRet: any) => {
            patchMenuItems(childRet)
            patchNestedMenuRenderers(childRet, depth + 1)
            return childRet
        })
    }
}

function getMenuItemIndexes(items: any[]) {
    return items.flatMap((item, index) => (item && item.$$typeof && item.type !== 'div') ? index : [])
}

function installDomMenuFallback() {
    let observer: MutationObserver | undefined
    let warned = false
    const onActivate = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()

        try {
            ((Navigation as any).Navigate || (Router as any).Navigate).call(Navigation, '/discord')
            ; (Navigation as any).CloseSideMenus?.()
        } catch (e) {
            console.error('Deckcord: Failed to navigate to Discord route:', e)
        }
    }

    const inject = () => {
        try {
            const menuRoot = getGamepadNavigationTrees()
                ?.find((tree: any) => tree.m_ID === 'MainNavMenuContainer')
                ?.Root?.Element as HTMLElement | undefined
            const menu = menuRoot?.querySelector('[role="menu"]') as HTMLElement | undefined
            if (!menuRoot || !menu) return

            const hasDiscordItem = Array.from(menuRoot.querySelectorAll('[role="menuitem"]'))
                .some((item) => item.getAttribute('aria-label') === 'Discord' || item.textContent?.trim() === 'Discord')
            if (hasDiscordItem || menu.querySelector('[data-deckcord-menu-item="true"]')) return

            const nestedMenuItems = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
            const directMenuItems = Array.from(menu.children)
                .filter((item): item is HTMLElement => item instanceof HTMLElement && item.getAttribute('role') === 'menuitem')
            const menuItems = directMenuItems.length ? directMenuItems : nestedMenuItems
            const template = menuItems.find((item) => item.getAttribute('aria-label') === 'Store') || menuItems[0]
            if (!template) return

            const deckcordItem = template.cloneNode(true) as HTMLElement
            deckcordItem.setAttribute('aria-label', 'Discord')
            deckcordItem.setAttribute('data-deckcord-menu-item', 'true')
            deckcordItem.title = 'Discord'
            deckcordItem.tabIndex = 0

            const templateLabel = template.getAttribute('aria-label')
            const labelNode = Array.from(deckcordItem.querySelectorAll('*')).find((node) => node.children.length === 0 && node.textContent?.trim() === templateLabel)
            if (labelNode) labelNode.textContent = 'Discord'
            else deckcordItem.textContent = 'Discord'

            deckcordItem.addEventListener('click', onActivate)
            deckcordItem.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') onActivate(event)
            })

            const browserPosition = Number.parseInt(localStorage.getItem("DECKCORD_MENU_POSITION") || "3" as string)
            const insertParent = directMenuItems.length ? menu : template.parentElement || menu
            const siblingItems = Array.from(insertParent.children)
                .filter((item): item is HTMLElement => item instanceof HTMLElement && item.getAttribute('role') === 'menuitem')
            const insertBefore = browserPosition === 9 ? null : siblingItems[browserPosition - 1] || null
            insertParent.insertBefore(deckcordItem, insertBefore)
        } catch (e) {
            if (!warned) {
                warned = true
                console.warn('Deckcord: Failed to inject fallback menu item:', e)
            }
        }
    }

    const interval = setInterval(inject, 1000)
    inject()

    try {
        observer = new MutationObserver(inject)
        observer.observe(document.documentElement, { childList: true, subtree: true })
    } catch (e) {
        console.warn('Deckcord: Failed to watch menu DOM for fallback injection:', e)
    }

    return () => {
        clearInterval(interval)
        observer?.disconnect()
        document.querySelectorAll('[data-deckcord-menu-item="true"]').forEach((node) => node.remove())
    }
}

interface MenuItemWrapperProps extends MainMenuItemPropsBase {
    MenuItemComponent: FC<MainMenuItemProps>;
    useIconAsProp: boolean;
}

const MenuItemWrapper: FC<MenuItemWrapperProps> = ({ MenuItemComponent, useIconAsProp, ...props }) => {
    const componentProps: any = { ...props };
    componentProps[useIconAsProp ? 'icon' : 'children'] = <FaDiscord />;

    return (
        <MenuItemComponent
            {...componentProps}
            label={'Discord'}
        />
    )
}
