import { MediaPreview } from "./MediaPreview.tsx";
import { PathBreadcrumbs } from "./PathBreadcrumbs.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileEntry, FileListing, FileOperation, FilePreview } from "@car/protocol";
import { request } from "../../api.ts";
import { addTab, getFiles, patchTab, setFiles, useFiles } from "./state.ts";
import "./files.css";
const leaf = (path: string) => path.split("/").filter(Boolean).pop() || "/";
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
export function FileBrowser({ onClose, workDirectory }: { onClose: () => void; workDirectory?: () => Promise<string | null> }) {
  const state = useFiles(); const tab = state.tabs.find((t) => t.id === state.active);
  const [roots, setRoots] = useState<string[]>([]);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const [writing, setWriting] = useState(false);
  const [revision, setRevision] = useState(0); const [menu, setMenu] = useState(false);
  const [home, setHome] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const selectionMode = selecting || !!tab?.selected.length;
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [menu]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 2500); return () => clearTimeout(timer); }, [notice]);
  const [dialog, setDialog] = useState<{ action: "file" | "directory" | "rename"; name: string; path?: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null); const requestRef = useRef<AbortController>();
  const previewRequest = useRef<AbortController>(); const writeLock = useRef(false);
  const touch = useRef<{ x: number; y: number }>(); const longPress = useRef<ReturnType<typeof setTimeout>>(); const held = useRef(false);
  useEffect(() => { const abort = new AbortController(); request<{ roots: string[]; home?: string }>("/api/files/roots", { signal: abort.signal }).then((r) => {
    setHome(r.home ?? ""); setRoots(r.roots); if (!getFiles().tabs.length && r.roots[0]) {
      if (workDirectory) void workDirectory().then((p) => { if (!getFiles().tabs.length) addTab(p ?? (r.home || r.roots[0]!)); }).catch(() => { if (!getFiles().tabs.length) addTab((r.home || r.roots[0]!)); });
      else addTab(r.home || r.roots[0]);
    }
  }).catch((e) => { if (!abort.signal.aborted) setError(e.message); }); return () => { abort.abort(); requestRef.current?.abort(); previewRequest.current?.abort(); clearTimeout(longPress.current); }; }, []);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); }, [dialog?.action]);
  const load = async (more = false) => {
    if (!tab) return;
    requestRef.current?.abort(); const abort = new AbortController(); requestRef.current = abort;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ path: tab.path, q: tab.query, mode: tab.mode, hidden: tab.hidden ? "1" : "0" });
      const first = more ? listing?.next ?? 0 : 0;
      let result: FileListing | null = null;
      let offset: number | null = first;
      const desired = more ? first + 100 : Math.max(100, tab.loaded || 100);
      while (offset !== null && offset < desired) {
        params.set("offset", String(offset));
        const page: FileListing = await request<FileListing>(`/api/files/list?${params}`, { signal: abort.signal });
        result = { ...page, entries: [...((result as FileListing | null)?.entries ?? []), ...page.entries] }; offset = page.next;
      }
      if (abort.signal.aborted || !result) return;
      setListing(more ? { ...result, entries: [...(listing?.entries ?? []), ...result.entries] } : result);
      if (more) patchTab(tab.id, { loaded: desired });
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  useEffect(() => {
    setListing(null); setPreview(null); previewRequest.current?.abort();
    const timer = setTimeout(() => void load(), tab?.query ? 250 : 0);
    return () => { clearTimeout(timer); requestRef.current?.abort(); };
  }, [tab?.id, tab?.path, tab?.query, tab?.mode, tab?.hidden, revision]);
  useLayoutEffect(() => { if (listRef.current && tab && listing) listRef.current.scrollTop = tab.scroll; }, [listing, tab?.id]);
  const navigate = (path: string) => { setSelecting(false); if (tab) patchTab(tab.id, { path, scroll: 0, selected: [], query: "", loaded: 100 }); };
  const toggle = (path: string) => { if (tab) patchTab(tab.id, { selected: tab.selected.includes(path) ? tab.selected.filter((p) => p !== path) : [...tab.selected, path] }); };
  const showPreview = async (entry: FileEntry) => {
    if (held.current) { held.current = false; return; }
    if (selectionMode) { toggle(entry.path); return; }
    if (entry.kind === "directory") { navigate(entry.path); return; }
    previewRequest.current?.abort(); const abort = new AbortController(); previewRequest.current = abort;
    setPreview(null); setError("");
    try { const p = await request<FilePreview>(`/api/files/preview?${new URLSearchParams({ path: entry.path })}`, { signal: abort.signal }); if (!abort.signal.aborted) setPreview(p); } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
  };
  const operate = async (op: FileOperation) => {
    if (writeLock.current) return; writeLock.current = true; setWriting(true); setError(""); setNotice("");
    try { await request("/api/files/operation", { method: "POST", body: JSON.stringify(op) }); setNotice("操作完成"); setDialog(null); dialogRef.current?.close(); setRevision((n) => n + 1); if (tab) patchTab(tab.id, { selected: [] }); }
    catch (e) { setError((e as Error).message); setRevision((n) => n + 1); }
    finally { writeLock.current = false; setWriting(false); }
  };
  const copyPath = async (paths: string[]) => { try { await navigator.clipboard.writeText(paths.join("\n")); setError(""); setNotice("路径已复制"); } catch { setError(`浏览器未允许复制，路径：${paths.join("、")}`); } };
  const switchTab = (direction: number) => { const i = state.tabs.findIndex((t) => t.id === state.active); const next = state.tabs[i + direction]; if (next) setFiles({ ...getFiles(), active: next.id }); };
  return <section className="file-browser" aria-label="文件系统">
    {state.tabs.length > 1 && <div className="file-tabs file-directory-tabs" role="tablist" aria-label="目录标签">{state.tabs.map((t) => <button role="tab" aria-selected={t.id === state.active} key={t.id} onClick={() => setFiles({ ...getFiles(), active: t.id })}>{leaf(t.path)}</button>)}</div>}
    <div className="file-toolbar">
      <button disabled={!listing?.parent} aria-label="返回上级目录" onClick={() => listing?.parent && navigate(listing.parent)}>↑</button>
      <PathBreadcrumbs path={tab?.path ?? "/"} home={home} roots={roots} onNavigate={navigate} />
      {!!state.clipboard.length && !selectionMode && <button disabled={writing || !tab} className="file-paste" onClick={() => tab && void operate({ action: "copy", paths: state.clipboard, directory: tab.path })}>{writing ? "处理中…" : `粘贴 ${state.clipboard.length}`}</button>}
      <button aria-label="搜索" aria-expanded={searchOpen || !!tab?.query} onClick={() => { const open = searchOpen || !!tab?.query; setSearchOpen(!open); if (open && tab) patchTab(tab.id, { query: "", loaded: 100, scroll: 0 }); }}>⌕</button>
      <div className="file-menu" ref={menuRef}><button aria-label="文件系统更多操作" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>{menu && <div className="file-menu-panel">
        <button disabled={!tab || writing} onClick={() => { setMenu(false); setError(""); setDialog({ action: "file", name: "" }); }}>新建文件</button>
        <button disabled={!tab || writing} onClick={() => { setMenu(false); setError(""); setDialog({ action: "directory", name: "" }); }}>新建文件夹</button>
        <button onClick={() => { setMenu(false); setSelecting(true); }}>选择文件</button>
        <button disabled={!tab} onClick={() => { setMenu(false); if (tab) void copyPath([tab.path]); }}>复制当前目录路径</button>
        <button onClick={() => { setMenu(false); setRevision((n) => n + 1); }}>刷新文件列表</button>
        <button aria-pressed={tab?.hidden ?? false} onClick={() => { setMenu(false); if (tab) patchTab(tab.id, { hidden: !tab.hidden, loaded: 100, scroll: 0 }); }}>{tab?.hidden ? "隐藏隐藏项" : "显示隐藏项"}</button>
        <button disabled={!tab} onClick={() => { setMenu(false); if (tab) addTab(tab.path); }}>新增目录标签</button>
        {!!state.clipboard.length && <button onClick={() => { setFiles({ ...getFiles(), clipboard: [] }); setMenu(false); }}>清空复制队列</button>}
        {workDirectory && <button onClick={() => { setMenu(false); void workDirectory().then((p) => p ? navigate(p) : setError("未找到 Agent 工作目录，可从主目录继续浏览")).catch((e) => setError(e.message)); }}>转到当前 Agent 工作目录</button>}
        {state.tabs.length > 1 && <button onClick={() => { const remaining = state.tabs.filter((t) => t.id !== state.active); setFiles({ ...state, tabs: remaining, active: remaining[0]!.id }); setMenu(false); }}>关闭当前目录标签</button>}
        {!!home && <button onClick={() => { setMenu(false); navigate(home); }}>主目录 ~</button>}
        <button onClick={onClose}>关闭文件系统</button>
      </div>}</div>
    </div>
    {(searchOpen || !!tab?.query) && <div className="file-search"><select aria-label="搜索范围" value={tab?.mode ?? "filter"} onChange={(e) => tab && patchTab(tab.id, { mode: e.target.value, loaded: 100, scroll: 0 })}><option value="filter">当前目录</option><option value="name">递归找文件</option><option value="content">搜索内容</option></select>
      <input autoFocus aria-label="搜索文件" placeholder="搜索…" value={tab?.query ?? ""} onChange={(e) => tab && patchTab(tab.id, { query: e.target.value, selected: [], loaded: 100, scroll: 0 })} />
      <button onClick={() => { requestRef.current?.abort(); setBusy(false); setSearchOpen(false); if (tab) patchTab(tab.id, { query: "", scroll: 0, loaded: 100 }); }}>取消</button>
    </div>}
    {error && <div className="file-message error" role="alert">{error}</div>}{notice && <div className="file-toast" role="status">{notice}</div>}
    <div className={`file-body${preview ? " has-preview" : ""}`}>
      <div className="file-list" ref={listRef} onScroll={(e) => { if (tab) patchTab(tab.id, { scroll: e.currentTarget.scrollTop }); }}
        onTouchStart={(e) => { const p = e.touches[0]; if (p) touch.current = { x: p.clientX, y: p.clientY }; }}
        onTouchMove={(e) => { const p = e.touches[0]; if (p && touch.current && Math.hypot(p.clientX-touch.current.x, p.clientY-touch.current.y) > 10) clearTimeout(longPress.current); }}
        onTouchEnd={(e) => { clearTimeout(longPress.current); const p = e.changedTouches[0]; if (touch.current && p) { const dx = p.clientX-touch.current.x; const dy = p.clientY-touch.current.y; if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)*2) switchTab(dx > 0 ? -1 : 1); } touch.current = undefined; }}>
        {listing?.entries.map((entry) => <div className={`file-row${tab?.selected.includes(entry.path) ? " selected" : ""}`} key={entry.path}>
          {selectionMode && <input type="checkbox" aria-label={`选择 ${entry.name}`} checked={tab?.selected.includes(entry.path) ?? false} onChange={() => toggle(entry.path)} />}
          <button className="file-entry" onClick={() => void showPreview(entry)} onContextMenu={(e) => { e.preventDefault(); toggle(entry.path); }}
            onPointerDown={(e) => { held.current = false; if (e.pointerType === "touch") longPress.current = setTimeout(() => { held.current = true; toggle(entry.path); }, 500); }} onPointerUp={() => clearTimeout(longPress.current)} onPointerCancel={() => clearTimeout(longPress.current)}>
            <span className="file-kind">{entry.kind === "directory" ? "▣" : entry.kind === "link" ? "↗" : "▤"}</span><span className="file-name">{entry.name}<small>{entry.excerpt ? `L${entry.line} · ${entry.excerpt}` : tab?.mode !== "filter" && tab?.query ? entry.path : entry.kind === "directory" ? "文件夹" : `${size(entry.size)} · ${new Date(entry.modified).toLocaleDateString()}`}</small></span>
          </button>
        </div>)}
        {busy && <p className="file-empty">正在查找…</p>}{!busy && listing && !listing.entries.length && <p className="file-empty">{tab?.query ? "没有匹配的文件" : "这个文件夹是空的"}</p>}
        {listing?.limited && <p className="file-empty">搜索达到时间或数量上限，请进入更具体的目录继续查找。内容搜索仅检查 128 KB 以内的文本，跳过 .git 和 node_modules。</p>}
        {listing?.next !== null && listing?.next !== undefined && <button className="file-more" disabled={busy} onClick={() => void load(true)}>加载更多文件</button>}
      </div>
      {preview && <aside className="file-preview" aria-label="文件预览"><div className="file-preview-header"><strong>{preview.name}</strong><button aria-label="关闭预览" onClick={() => setPreview(null)}>×</button></div><div className="file-actions"><span>{size(preview.size)}</span><button onClick={() => void copyPath([preview.path])}>复制路径</button>{preview.size <= 20*1024*1024 && <a href={`/api/files/download?${new URLSearchParams({ path: preview.path })}`} download={preview.name}>下载</a>}</div>
        {preview.kind === "video" || preview.kind === "audio" ? <MediaPreview key={preview.path} preview={preview} /> : preview.kind === "image" ? <img alt={preview.name} src={`/api/files/download?${new URLSearchParams({ path: preview.path, inline: "1" })}`} /> : preview.kind === "text" ? <pre>{preview.text}</pre> : <p>此格式暂不支持预览。</p>}{preview.truncated && <p>仅预览前 128 KB。</p>}
      </aside>}
    </div>
    {selectionMode && <div className="file-selection"><div className="file-selection-heading"><span>已选 {tab?.selected.length ?? 0} 项</span><button onClick={() => tab && patchTab(tab.id, { selected: listing?.entries.map((e) => e.path) ?? [] })}>全选</button><button onClick={() => { setSelecting(false); if (tab) patchTab(tab.id, { selected: [] }); }}>完成</button></div><div className="file-selection-actions"><button disabled={!tab?.selected.length} onClick={() => { setFiles({ ...getFiles(), clipboard: tab!.selected }); patchTab(tab!.id, { selected: [] }); setSelecting(false); setNotice("已复制，进入目标目录后粘贴"); }}>复制</button><button disabled={!tab?.selected.length} onClick={() => tab && void copyPath(tab.selected)}>复制地址</button><button disabled={tab?.selected.length !== 1 || writing} onClick={() => tab && setDialog({ action: "rename", path: tab.selected[0]!, name: leaf(tab.selected[0]!) })}>重命名</button></div></div>}
    <dialog ref={dialogRef} className="rename-dialog" aria-label="文件操作" onCancel={() => setDialog(null)} onClose={() => setDialog(null)}>{dialog && <form onSubmit={(e) => { e.preventDefault(); if (!tab) return; void operate(dialog.action === "rename" ? { action: "rename", path: dialog.path!, name: dialog.name } : { action: "create", directory: tab.path, name: dialog.name, kind: dialog.action }); }}><h2>{dialog.action === "rename" ? "重命名" : dialog.action === "file" ? "新建文件" : "新建文件夹"}</h2><label>名称<input autoFocus value={dialog.name} maxLength={255} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} /></label>{error && <p role="alert">{error}</p>}<div className="rename-dialog-actions"><button type="button" disabled={writing} onClick={() => dialogRef.current?.close()}>取消</button><button type="submit" disabled={writing || !dialog.name.trim()}>{writing ? "处理中…" : "保存"}</button></div></form>}</dialog>
  </section>;
}
