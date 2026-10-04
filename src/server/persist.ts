/* runtime.json — launch runs, trade loops, auto-dump watchers and pending mints survive a dev-server restart.
 * Each module registers a producer (its serializable snapshot) and reads its own section once at first use;
 * restored loops/watchers come back "stopped, resumable" (nothing restarts on its own). jobs live in jobs.json. */
import { readJson, store, writeJson } from "./store";

type RuntimeFile = Record<string, unknown>;

type Bag = { file: RuntimeFile | null; producers: Map<string, () => unknown>; timer: ReturnType<typeof setTimeout> | null; restored: Set<string> };

function bag(): Bag {
  const rt = store().runtime;
  if (!rt.persist) rt.persist = { file: null, producers: new Map(), timer: null, restored: new Set() } satisfies Bag;
  return rt.persist as Bag;
}

function file(): RuntimeFile {
  const b = bag();
  if (!b.file) b.file = readJson<RuntimeFile>(store().paths.runtime, {});
  return b.file;
}

/** the saved section `name`, exactly once per process (undefined afterwards and when nothing was saved) */
export function restoreSection<T>(name: string): T | undefined {
  const b = bag();
  if (b.restored.has(name)) return undefined;
  b.restored.add(name);
  return file()[name] as T | undefined;
}

export function registerRuntimeProducer(name: string, fn: () => unknown): void {
  bag().producers.set(name, fn);
}

/** write runtime.json at most every 500 ms with every registered section (unregistered sections are kept) */
export function saveRuntimeSoon(): void {
  const b = bag();
  if (b.timer) return;
  b.timer = setTimeout(() => {
    b.timer = null;
    try {
      const out: RuntimeFile = { ...file() };
      for (const [name, fn] of b.producers) out[name] = fn();
      out.savedAt = Date.now();
      b.file = out;
      writeJson(store().paths.runtime, out);
    } catch {
      /* disk error: keep in memory */
    }
  }, 500);
}

export const RESTORE_NOTE = "Restored after a server restart: stopped, nothing was sent since. Resume it explicitly to continue.";
