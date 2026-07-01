import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Search, RefreshCw, Trash2, CheckCircle2, Link2, Download } from "lucide-react";
import { API, fmtBytes } from "../lib/api";
import { SectionHeader, Badge, StatCard } from "./shared";
import { useToast } from "./Toast";

export const DuplicatesPanel = ({ refreshAll }) => {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const toast = useToast();

  const load = useCallback(async () => {
    const params = { q: q || undefined, reason: reason !== "all" ? reason : undefined, limit: 500 };
    if (statusFilter !== "all") params.reclaimed = statusFilter === "reclaimed";
    const [{ data }, { data: s }] = await Promise.all([
      axios.get(`${API}/duplicates`, { params }),
      axios.get(`${API}/duplicates/stats`),
    ]);
    setItems(data.items || []);
    setStats(s);
  }, [q, reason, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const markReclaimed = async (id) => {
    await axios.post(`${API}/duplicates/${id}/mark-reclaimed`);
    toast.ok("Marked reclaimed");
    load(); refreshAll();
  };
  const dismiss = async (id) => {
    await axios.delete(`${API}/duplicates/${id}`);
    toast.info("Record dismissed");
    load(); refreshAll();
  };
  const scriptHref = (id, p) => `${API}/duplicates/${id}/script?platform=${p}`;
  const reclaimAllHref = (p) => `${API}/duplicates/reclaim-all?platform=${p}`;

  const reasonChips = ["all", "vault_match", "batch_duplicate", "upload_duplicate"];
  const hasActive = (stats?.active || 0) > 0;

  return (
    <div>
      <SectionHeader index="05" title="Duplicates · Reclaim" sub={`${stats?.active ?? 0} reclaimable`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard testId="dup-stats-total" label="All Detections" value={stats?.total ?? 0} sub="Historic total" />
        <StatCard testId="dup-stats-active" label="Active" value={stats?.active ?? 0} tone="alert" sub="Awaiting reclaim" />
        <StatCard testId="dup-stats-reclaimed" label="Reclaimed" value={stats?.reclaimed ?? 0} tone="accent" sub="Symlinked" />
        <StatCard testId="dup-stats-bytes" label="Reclaimable" value={fmtBytes(stats?.reclaimable_bytes || 0)} tone="accent" sub="Disk space" />
      </div>

      {hasActive && (
        <div className="border border-orange-500 bg-orange-500/5 p-5 mb-6 flex flex-col md:flex-row items-start md:items-center gap-4" data-testid="reclaim-all-bar">
          <div className="flex-1">
            <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-orange-500 mb-1">
              &gt; master_action · reclaim_everything
            </div>
            <div className="text-white text-sm">
              Generate one script that turns every one of your <span className="text-orange-400 font-bold">{stats.active}</span> active duplicates into symlinks. Recover <span className="text-orange-400 font-bold">{fmtBytes(stats.reclaimable_bytes || 0)}</span> in one execution.
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <a data-testid="reclaim-all-posix-btn" href={reclaimAllHref("posix")}
              className="border-2 border-orange-500 bg-orange-500 hover:bg-orange-400 text-black font-mono text-xs uppercase tracking-[0.25em] px-4 py-2 flex items-center gap-2">
              <Download size={13} strokeWidth={2} /> reclaim_all.sh
            </a>
            <a data-testid="reclaim-all-windows-btn" href={reclaimAllHref("windows")}
              className="border-2 border-orange-500 hover:bg-orange-500 hover:text-black text-orange-400 font-mono text-xs uppercase tracking-[0.25em] px-4 py-2 flex items-center gap-2">
              <Download size={13} strokeWidth={2} /> reclaim_all.ps1
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="flex-1 flex items-center border-b-2 border-zinc-800 focus-within:border-orange-500">
          <Search size={14} className="text-zinc-500 mr-2" strokeWidth={1.5} />
          <input data-testid="duplicates-search-input"
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="search :: filename / path / hash"
            className="bg-transparent w-full py-2 font-mono text-sm text-white placeholder:text-zinc-600" />
        </div>
        <button data-testid="duplicates-refresh" onClick={load}
          className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 text-zinc-300 font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-2 flex items-center gap-1">
          <RefreshCw size={12} strokeWidth={1.5} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {reasonChips.map((r) => (
          <button key={r} data-testid={`dup-reason-chip-${r}`}
            onClick={() => setReason(r)}
            className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ${
              reason === r ? "bg-white text-black border-white font-bold"
                          : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500"
            }`}>{r.replace("_", " ")}</button>
        ))}
        <div className="w-px bg-zinc-800 mx-1" />
        {["active", "reclaimed", "all"].map((s) => (
          <button key={s} data-testid={`dup-status-chip-${s}`}
            onClick={() => setStatusFilter(s)}
            className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ${
              statusFilter === s ? "bg-orange-500/20 text-orange-400 border-orange-500 font-bold"
                                 : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500"
            }`}>{s}</button>
        ))}
      </div>

      <div className="border border-zinc-800 overflow-x-auto" data-testid="duplicates-table">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="border-b border-zinc-800 text-left">
              {["#", "Duplicate at", "Canonical at", "Size", "Reason", "Status", "Reclaim", ""].map((h, i) => (
                <th key={i} className="py-2 px-4 text-[10px] tracking-[0.25em] uppercase text-zinc-500 font-mono">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={8} className="py-16 text-center font-mono text-xs text-zinc-600 uppercase tracking-widest">
                // no duplicates detected · try scanning a folder
              </td></tr>
            )}
            {items.map((d, i) => (
              <tr key={d.id} className={`border-b border-zinc-900 hover:bg-zinc-900/40 ${d.reclaimed ? "opacity-50" : ""}`}>
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-600">{String(i + 1).padStart(3, "0")}</td>
                <td className="py-2 px-4 font-mono text-[11px] text-red-300 truncate max-w-[260px]" title={d.scanned_path}>{d.scanned_path}</td>
                <td className="py-2 px-4 font-mono text-[11px] text-emerald-400 truncate max-w-[260px]" title={d.existing_path}>{d.existing_path}</td>
                <td className="py-2 px-4 font-mono text-xs text-zinc-400">{fmtBytes(d.size)}</td>
                <td className="py-2 px-4">
                  <Badge tone={d.reason === "vault_match" ? "alert" : d.reason === "upload_duplicate" ? "accent" : "default"}>
                    {d.reason.replace("_", " ")}
                  </Badge>
                </td>
                <td className="py-2 px-4">
                  <Badge tone={d.reclaimed ? "ok" : "alert"}>{d.reclaimed ? "reclaimed" : "active"}</Badge>
                </td>
                <td className="py-2 px-4">
                  <div className="flex items-center gap-1">
                    <a data-testid={`reclaim-posix-${d.id}`} href={scriptHref(d.id, "posix")}
                      className="border border-orange-500/60 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 flex items-center gap-1"
                      title="Download .sh reclaim script (Mac/Linux)">
                      <Link2 size={11} strokeWidth={1.5} /> .sh
                    </a>
                    <a data-testid={`reclaim-windows-${d.id}`} href={scriptHref(d.id, "windows")}
                      className="border border-orange-500/60 hover:border-orange-500 hover:bg-orange-500/10 text-orange-400 font-mono text-[10px] uppercase tracking-[0.2em] px-2 py-1 flex items-center gap-1"
                      title="Download .ps1 reclaim script (Windows)">
                      <Link2 size={11} strokeWidth={1.5} /> .ps1
                    </a>
                  </div>
                </td>
                <td className="py-2 px-4">
                  <div className="flex items-center gap-1 justify-end">
                    {!d.reclaimed && (
                      <button data-testid={`mark-reclaimed-${d.id}`} onClick={() => markReclaimed(d.id)}
                        className="text-zinc-500 hover:text-emerald-400 border border-transparent hover:border-emerald-500/40 p-1"
                        title="Mark reclaimed">
                        <CheckCircle2 size={14} strokeWidth={1.5} />
                      </button>
                    )}
                    <button data-testid={`dismiss-duplicate-${d.id}`} onClick={() => dismiss(d.id)}
                      className="text-zinc-500 hover:text-red-400 border border-transparent hover:border-red-500/40 p-1"
                      title="Dismiss record">
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
        [i] Downloaded scripts back up the duplicate to /tmp before replacing it with a symlink.
      </div>
    </div>
  );
};
