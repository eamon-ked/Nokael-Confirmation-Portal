import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HandoffKind, JobOutcome } from "../logic/model";

export type Route =
  | { name: "startup" }
  | { name: "login" }
  | { name: "verify" }
  | { name: "home" }
  | { name: "job"; jobId: string }
  | { name: "otp"; jobId: string; kind: HandoffKind }
  | { name: "return"; jobId: string }
  | { name: "result"; outcome: JobOutcome };

export function routePath(route: Route): string {
  switch (route.name) {
    case "job":
      return `#/job/${encodeURIComponent(route.jobId)}`;
    case "otp":
      return `#/otp/${encodeURIComponent(route.jobId)}/${route.kind}`;
    case "return":
      return `#/return/${encodeURIComponent(route.jobId)}`;
    case "result":
      return `#/result/${route.outcome}`;
    case "startup":
      return "#/";
    default:
      return `#/${route.name}`;
  }
}

/** The route in the address bar, so a reload mid-job can land back on that job. */
export function parseHash(hash: string): Route | null {
  const [name, a, b] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  switch (name) {
    case "home":
      return { name: "home" };
    case "job":
      return a ? { name: "job", jobId: a } : null;
    case "otp":
      return a && (b === "PICKUP" || b === "DROPOFF") ? { name: "otp", jobId: a, kind: b } : null;
    case "return":
      return a ? { name: "return", jobId: a } : null;
    default:
      return null;
  }
}

interface Navigator {
  current: Route;
  push(route: Route): void;
  back(): void;
  /** Replaces the whole stack (sign-in, sign-out). */
  resetTo(...routes: Route[]): void;
  /** Pops back to the nearest `name` below the top, if any. */
  popTo(name: Route["name"]): void;
}

const NavContext = createContext<Navigator | null>(null);

export const useNav = () => {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside NavProvider");
  return nav;
};

/**
 * A screen stack mirrored onto browser history: each push adds a history
 * entry, so the phone's back button / back gesture pops a screen exactly like
 * on Android. `history.state.depth` says which stack entry a history entry is.
 */
export function NavProvider({ children }: { children: (route: Route) => ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "startup" }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  /** Scroll offset of each screen in the stack, so going back lands where the driver was. */
  const scrollByDepth = useRef<number[]>([]);
  const shownDepth = useRef(0);

  useLayoutEffect(() => {
    const depth = stack.length - 1;
    const wentBack = depth < shownDepth.current;
    window.scrollTo(0, wentBack ? (scrollByDepth.current[depth] ?? 0) : 0);
    shownDepth.current = depth;
  }, [stack]);

  useEffect(() => {
    history.replaceState({ depth: 0 }, "", location.hash || "#/");
    const onPop = (event: PopStateEvent) => {
      const depth = typeof event.state?.depth === "number" ? event.state.depth : 0;
      const current = stackRef.current;
      if (depth < current.length - 1) {
        setStack(current.slice(0, depth + 1));
      } else {
        // A stale entry from before a reset: stay put and keep the address bar honest.
        history.replaceState({ depth: current.length - 1 }, "", routePath(current[current.length - 1]));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((route: Route) => {
    scrollByDepth.current[stackRef.current.length - 1] = window.scrollY;
    const next = [...stackRef.current, route];
    history.pushState({ depth: next.length - 1 }, "", routePath(route));
    stackRef.current = next;
    setStack(next);
  }, []);

  const back = useCallback(() => {
    if (stackRef.current.length > 1) history.back();
  }, []);

  const resetTo = useCallback((...routes: Route[]) => {
    const next = routes.length ? routes : [{ name: "login" } as Route];
    scrollByDepth.current = [];
    // Only the top entry is represented in history; older ones are pushed in order.
    history.replaceState({ depth: 0 }, "", routePath(next[0]));
    next.slice(1).forEach((route, i) => history.pushState({ depth: i + 1 }, "", routePath(route)));
    stackRef.current = next;
    setStack(next);
  }, []);

  const popTo = useCallback((name: Route["name"]) => {
    const current = stackRef.current;
    for (let i = current.length - 2; i >= 0; i--) {
      if (current[i].name === name) {
        history.go(i - (current.length - 1));
        return;
      }
    }
    resetTo({ name } as Route);
  }, [resetTo]);

  const current = stack[stack.length - 1];
  const nav = useMemo(() => ({ current, push, back, resetTo, popTo }), [current, push, back, resetTo, popTo]);
  return <NavContext.Provider value={nav}>{children(current)}</NavContext.Provider>;
}
