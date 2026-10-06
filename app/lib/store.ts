"use client";
// Hydration-safe localStorage state shared by every tool.
// useSyncExternalStore renders the fallback on the server / first paint and
// the stored value right after, and keeps every component using the same key
// (even across tools on one page) in sync.
import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const parsed = new Map<string, { raw: string | null; value: unknown }>();
const fallbacks = new Map<string, unknown>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => { parsed.clear(); cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

export function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return fallback; }
  const hit = parsed.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: unknown = fallback;
  if (raw != null) { try { value = JSON.parse(raw); } catch { value = fallback; } }
  parsed.set(key, { raw, value });
  return value as T;
}

export function writeStored<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
  listeners.forEach((l) => l());
}

export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  if (!fallbacks.has(key)) fallbacks.set(key, fallback);
  const stableFallback = fallbacks.get(key) as T;
  const value = useSyncExternalStore(
    subscribe,
    () => readStored(key, stableFallback),
    () => stableFallback,
  );
  const set = useCallback((v: T | ((prev: T) => T)) => {
    const prev = readStored(key, stableFallback);
    const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
    writeStored(key, next);
  }, [key, stableFallback]);
  return [value, set];
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const noop = () => () => {};
/** Read a ?query param without needing a Suspense boundary. */
export function useQueryParam(name: string): string {
  return useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get(name) || "",
    () => "",
  );
}
