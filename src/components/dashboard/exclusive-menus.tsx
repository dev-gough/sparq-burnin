"use client";

import * as React from "react";

function useMenuController() {
  const [active, setActive] = React.useState<string | null>(null);
  const current = React.useRef<string | null>(null);
  const pending = React.useRef<string | null>(null);
  const closing = React.useRef<string | null>(null);
  const frame = React.useRef<number | null>(null);

  const waitForExit = React.useCallback(function checkExit() {
    // Presence removes the old panel after its real exit animation. Waiting
    // for removal also handles slow frames and reduced motion without timers.
    const oldPanel = [...document.querySelectorAll("[data-exclusive-menu]")]
      .some(node => node.getAttribute("data-exclusive-menu") === closing.current);
    if (oldPanel) {
      frame.current = requestAnimationFrame(checkExit);
      return;
    }
    frame.current = null;
    closing.current = null;
    if (pending.current) {
      current.current = pending.current;
      pending.current = null;
      setActive(current.current);
    }
  }, []);

  const setOpen = React.useCallback((id: string, open: boolean) => {
    const close = () => {
      closing.current = current.current;
      current.current = null;
      setActive(null);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(waitForExit);
    };
    if (!open) {
      if (pending.current === id) pending.current = null;
      if (current.current === id) close();
      return;
    }
    if (current.current === id) return;
    pending.current = id;
    if (current.current) close();
    else if (!closing.current) {
      current.current = id;
      pending.current = null;
      setActive(id);
    }
  }, [waitForExit]);

  React.useEffect(() => {
    let width = window.innerWidth;
    const dismiss = () => {
      // Phone browser bars can resize the height while a menu is in use.
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      pending.current = null;
      if (current.current) setOpen(current.current, false);
    };
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("resize", dismiss);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [setOpen]);

  const hasDestination = React.useCallback(() => Boolean(pending.current || current.current), []);
  const onCloseAutoFocus = React.useCallback((event: Event) => {
    // The old menu's delayed focus restoration must not dismiss its replacement.
    if (pending.current || current.current) event.preventDefault();
  }, []);
  return { active, setOpen, hasDestination, onCloseAutoFocus };
}

const MenusContext = React.createContext<ReturnType<typeof useMenuController> | null>(null);

export function DashboardMenusProvider({ children }: { children: React.ReactNode }) {
  const menus = useMenuController();
  return <MenusContext.Provider value={menus}>{children}</MenusContext.Provider>;
}

export function useExclusiveMenus() {
  const local = useMenuController();
  return React.useContext(MenusContext) ?? local;
}
