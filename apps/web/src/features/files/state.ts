import { useSyncExternalStore } from "react";
export interface BrowserTab { id: string; path: string; scroll: number; selected: string[]; query: string; mode: string; hidden: boolean; loaded: number }
interface BrowserState { tabs: BrowserTab[]; active: string; clipboard: string[] }
const KEY = "car.files.v1";
function initial(): BrowserState {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (s && Array.isArray(s.tabs) && s.tabs.every((t: BrowserTab) => typeof t.path === "string" && Array.isArray(t.selected) && typeof t.query === "string") && s.tabs.some((t: BrowserTab) => t.id === s.active)) return { ...s, clipboard: Array.isArray(s.clipboard) ? s.clipboard : [] }; } catch { /* unavailable storage */ }
  return { tabs: [], active: "", clipboard: [] };
}
let state = initial();
const listeners = new Set<() => void>();
export function setFiles(next: BrowserState) { state = next; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* unavailable storage */ } listeners.forEach((f) => f()); }
export function getFiles() { return state; }
export function patchTab(id: string, patch: Partial<BrowserTab>) { setFiles({ ...state, tabs: state.tabs.map((t) => t.id === id ? { ...t, ...patch } : t) }); }
export function addTab(path: string) { const id = crypto.randomUUID(); setFiles({ ...state, active: id, tabs: [...state.tabs, { id, path, scroll: 0, selected: [], query: "", mode: "filter", hidden: false, loaded: 100 }] }); }
export function useFiles() { return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, getFiles); }
export function isFilesOpen(id: string) { try { return localStorage.getItem(`car.files.open.${id}`) === "1"; } catch { return false; } }
export function saveFilesOpen(id: string, open: boolean) { try { localStorage.setItem(`car.files.open.${id}`, open ? "1" : "0"); } catch { /* unavailable storage */ } }
