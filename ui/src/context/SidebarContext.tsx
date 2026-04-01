import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface SidebarContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  isMobile: boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const MOBILE_BREAKPOINT = 768;
const DESKTOP_STORAGE_KEY = "paperclip:sidebar-open:desktop";

function readDesktopSidebarPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(DESKTOP_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeDesktopSidebarPreference(open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESKTOP_STORAGE_KEY, String(open));
  } catch {
    // Ignore storage failures.
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const [sidebarOpen, setSidebarOpenState] = useState(() =>
    window.innerWidth < MOBILE_BREAKPOINT ? false : readDesktopSidebarPreference()
  );

  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpenState(open);
    if (window.innerWidth >= MOBILE_BREAKPOINT) {
      writeDesktopSidebarPreference(open);
    }
  }, []);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (e.matches) {
        setSidebarOpenState(false);
      } else {
        setSidebarOpenState(readDesktopSidebarPreference());
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      writeDesktopSidebarPreference(sidebarOpen);
    }
  }, [isMobile, sidebarOpen]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  return (
    <SidebarContext.Provider value={{ sidebarOpen, setSidebarOpen, toggleSidebar, isMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return ctx;
}
