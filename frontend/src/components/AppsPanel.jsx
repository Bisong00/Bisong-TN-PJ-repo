import React, { useState } from "react";
import axios from "axios";
import { Search, Plus, Trash2, Download } from "lucide-react";
import { API, PLATFORMS } from "../lib/api";
import { SectionHeader, Badge } from "./shared";

export const AppsPanel = ({ apps, refresh, onDup }) => {
  const [form, setForm] = useState({ app_name: "", version: "", install_path: "", platform: "windows", notes: "" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("all");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.app_name || !form.version || !form.install_path) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/apps`, form);
      if (data.duplicate) onDup(data.record);
      setForm({ app_name: "", version: "", install_path: "", platform: form.platform, notes: "" });
      refresh();
    } finally { setBusy(false); }
  };

  const del = async (id) => { await axios.delete(`${API}/apps/${id}`); refresh(); };

  const filtered = apps.filter((a) => {
    const matchQ = !q || [a.app_name, a.version, a.install_path].some((x) => x.toLowerCase().includes(q.toLowerCase()));
    const matchP = platform === "all" || a.platform === platform;
    return matchQ && matchP;
  });

  return (
    <div>
      <SectionHeader index="03" title="Application Registry" sub={`${apps.length} installed`} />

      <div className="grid md:grid-cols-5 gap-3 border border-zinc-800 bg-zinc-950 p-5 mb-8" data-testid="app-register-form">
        <input data-testid="app-name-input"
          value={form.app_name} onChange={(e) => setForm({ ...form, app_name: e.target.value })}
          placeholder="app_name" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs" />
        <input data-testid="app-version-input"
          value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
          placeholder="version (e.g. 1.4.2)" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs" />
        <input data-testid="app-path-input"
          value={form.install_path} onChange={(e) => setForm({ ...form, install_path: e.target.value })}
          placeholder="/Applications/Foo.app" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs md:col-span-2" />
        <select data-testid="app-platform-select"
          value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
          className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs">
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input data-testid="app-notes-input"
          value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="notes (optional)" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs md:col-span-4" />
        <button data-testid="app-register-submit" disabled={busy} onClick={submit}
          className="border border-orange-500 bg-orange-500/10 hover:bg-orange-500 hover:text-black text-orange-400 font-mono text-xs uppercase tracking-[0.2em] px-4 py-2 flex items-center justify-center gap-2">
          <Plus size={14} strokeWidth={1.5} /> Register
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="flex-1 flex items-center border-b-2 border-zinc-800 focus-within:border-orange-500">
          <Search size={14} className="text-zinc-500 mr-2" strokeWidth={1.5} />
          <input data-testid="apps-search-input"
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="search apps"
            className="bg-transparent w-full py-2 font-mono text-sm text-white placeholder:text-zinc-600" />
        </div>
        <div className="flex gap-2">
          <a data-testid="export-apps-csv" href={`${API}/apps/export?format=csv`}
             className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 text-zinc-300 font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-2 flex items-center gap-1">
            <Download size={12} strokeWidth={1.5} /> CSV
          </a>
          <a data-testid="export-apps-json" href={`${API}/apps/export?format=json`}
             className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 text-zinc-300 font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-2 flex items-center gap-1">
            <Download size={12} strokeWidth={1.5} /> JSON
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          {["all", ...PLATFORMS].map((p) => (
            <button key={p} data-testid={`platform-chip-${p}`}
              onClick={() => setPlatform(p)}
              className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ${
                platform === p ? "bg-white text-black border-white font-bold"
                              : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500"
              }`}>{p}</button>
          ))}
        </div>
      </div>

      <div className="border border-zinc-800 overflow-x-auto" data-testid="apps-registry-table">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-zinc-800 text-left">
              {["#", "App", "Version", "Platform", "Install Path", "Notes", "Added", ""].map((h, i) => (
                <th key={i} className="py-2 px-4 text-[10px] tracking-[0.25em] uppercase text-zinc-500 font-mono">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="py-16 text-center font-mono text-xs text-zinc-600 uppercase tracking-widest">
                // no applications registered
              </td></tr>
            )}
            {filtered.map((a, i) => (
              <tr key={a.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-600">{String(i + 1).padStart(3, "0")}</td>
                <td className="py-2 px-4 text-sm text-white">{a.app_name}</td>
                <td className="py-2 px-4 font-mono text-xs text-orange-400">{a.version}</td>
                <td className="py-2 px-4"><Badge>{a.platform}</Badge></td>
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-400 truncate max-w-[260px]">{a.install_path}</td>
                <td className="py-2 px-4 text-xs text-zinc-500 truncate max-w-[180px]">{a.notes || "—"}</td>
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-500">{new Date(a.created_at).toLocaleDateString()}</td>
                <td className="py-2 px-4 text-right">
                  <button data-testid={`delete-app-${a.id}`} onClick={() => del(a.id)}
                    className="text-zinc-500 hover:text-red-400 border border-transparent hover:border-red-500/40 p-1"
                    title="Purge record">
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
