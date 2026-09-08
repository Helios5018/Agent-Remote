import { useEffect, useRef, useState } from "react";
import type { FileEntry, FileListing } from "@car/protocol";
import { request } from "../../api.ts";

export function ParentDirectory({ path, current, hidden, onNavigate, title = "上级目录", className = "file-parent", onOpen }: {
  title?: string; className?: string; onOpen?: (entry: FileEntry) => void;
  path: string | null; current: string; hidden: boolean; onNavigate: (path: string) => void;
}) {
  const [listing, setListing] = useState<FileListing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController>();
  const load = async (offset = 0) => {
    if (!path) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError("");
    try {
      const result = await request<FileListing>(`/api/files/list?${new URLSearchParams({ path, hidden: hidden ? "1" : "0", offset: String(offset) })}`, { signal: abort.signal });
      if (!abort.signal.aborted) setListing((prev) => offset ? { ...result, entries: [...(prev?.entries ?? []), ...result.entries] } : result);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  useEffect(() => { setListing(null); void load(); return () => controller.current?.abort(); }, [path, hidden]);
  return <aside className={className} aria-label={className.includes("file-child") ? "下级目录内容" : "上级目录"}>
    <div className="file-column-heading">{title}</div>
    {!path && <p className="file-empty">已到文件系统根目录</p>}
    {error && <p role="alert" className="file-empty">{error}</p>}
    {listing?.entries.map((entry) => <button key={entry.path} className={entry.path === current ? "current" : ""} aria-current={entry.path === current ? "location" : undefined} disabled={!onOpen && entry.kind !== "directory"} onClick={() => onOpen ? onOpen(entry) : onNavigate(entry.path)} title={entry.path}>
      <span>{entry.kind === "directory" ? "▣" : "▤"}</span><span>{entry.name}</span>
    </button>)}
    {listing && !listing.entries.length && !busy && <p className="file-empty">这个文件夹是空的</p>}
    {busy && <p className="file-empty">读取中…</p>}
    {listing?.next != null && <button disabled={busy} onClick={() => void load(listing.next!)}>加载更多</button>}
  </aside>;
}
