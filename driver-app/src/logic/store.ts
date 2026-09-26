import { useSyncExternalStore } from "react";

/**
 * The web stand-in for Kotlin's `MutableStateFlow`: one value, readable at any
 * time, with change notifications. Screens read it through [useStore].
 */
export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((listener) => listener());
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
