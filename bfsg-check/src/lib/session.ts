"use client";
import { useSyncExternalStore } from "react";
import type { CheckSession, StatementFields } from "./scan/types";

/**
 * Sitzungszustand lebt ausschließlich im Browser (sessionStorage dieses Tabs).
 * Der Server speichert nichts. Beim Schließen des Tabs ist alles weg.
 * Ist sessionStorage blockiert, läuft die Sitzung im Arbeitsspeicher weiter.
 */
const KEY = "bfsg-check:session:v1";

export const EMPTY_STATEMENT: StatementFields = { organisation: "", address: "", feedback: "" };
const EMPTY: CheckSession = { version: 1, url: "", statuses: {}, statement: EMPTY_STATEMENT };

let memory: CheckSession | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: CheckSession = EMPTY;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): CheckSession {
  if (!raw) return memory ?? EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<CheckSession>;
    if (parsed && parsed.version === 1 && typeof parsed.url === "string") {
      return {
        version: 1,
        url: parsed.url,
        answers: parsed.answers,
        scope: parsed.scope,
        scan: parsed.scan,
        statuses: parsed.statuses ?? {},
        statement: { ...EMPTY_STATEMENT, ...parsed.statement },
      };
    }
  } catch {
    /* beschädigte Daten ignorieren */
  }
  return EMPTY;
}

function getSnapshot(): CheckSession {
  const raw = readRaw();
  if (raw !== cachedRaw || (raw === null && memory !== null && cachedValue !== memory)) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(next: CheckSession): void {
  memory = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Speicher voll oder blockiert – Arbeitsspeicher-Fallback */
  }
  cachedRaw = undefined;
  listeners.forEach((l) => l());
}

export function updateSession(update: Partial<CheckSession> | ((current: CheckSession) => Partial<CheckSession>)): void {
  const current = getSnapshot();
  const patch = typeof update === "function" ? update(current) : update;
  write({ ...current, ...patch, version: 1 });
}

/** Startet einen neuen Check: Ergebnisse und Status verwerfen, Texteingaben behalten. */
export function resetCheck(url: string): void {
  const current = getSnapshot();
  write({ version: 1, url, statuses: {}, statement: current.statement });
}

export function clearSession(): void {
  memory = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
  cachedRaw = undefined;
  listeners.forEach((l) => l());
}

const subscribeNoop = () => () => {};

/** false auf dem Server und während der Hydration, danach true. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export function useCheckSession(): { session: CheckSession; hydrated: boolean; update: typeof updateSession } {
  const session = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const hydrated = useHydrated();
  return { session, hydrated, update: updateSession };
}
