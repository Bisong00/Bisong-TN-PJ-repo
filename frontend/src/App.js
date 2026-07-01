import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/App.css";
import axios from "axios";
import {
  Upload, Search, Trash2, X, AlertTriangle, FileText, FileAudio, FileVideo,
  Image as ImageIcon, Package, File as FileIcon, HardDrive, ShieldAlert,
  Layers, Cpu, Terminal, Plus, MapPin, CheckCircle2,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// ---------- Helpers ----------
const fmtBytes = (b) => {
  if (b === 0 || b == null) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};

const catIcon = (c) => {
  const p = { size: 14, strokeWidth: 1.5 };
  switch (c) {
    case "pdf": return <FileText {...p} />;
    case "doc": return <FileText {...p} />;
    case "audio": return <FileAudio {...p} />;
    case "video": return <FileVideo {...p} />;
    case "image": return <ImageIcon {...p} />;
    case "installer": return <Package {...p} />;
    default: return <FileIcon {...p} />;
  }
};

const CATEGORIES = ["all", "pdf", "doc", "audio", "video", "image", "installer", "other"];
const PLATFORMS = ["windows", "mac", "linux", "android", "ios"];

// ---------- Shared UI ----------
const SectionHeader = ({ index, title, sub }) => (
  <div className="flex items-end justify-between border-b border-zinc-800 pb-3 mb-6">
    <div>
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 font-mono">SECTION / {index}</div>
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight uppercase mt-1">{title}</h2>
    </div>
    {sub && <div className="hidden md:block text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500">{sub}</div>}
  </div>
);

const Badge = ({ children, tone = "default", testId }) => {
  const tones = {
    default: "border-zinc-700 text-zinc-300",
    accent: "border-orange-500 text-orange-400",
    alert: "border-red-500 text-red-400 bg-red-950/30",
    ok: "border-emerald-500 text-emerald-400",
  };
  return (
    <span data-testid={testId}
      className={`inline-flex items-center gap-1.5 border px-2 py-[2px] text-[10px] tracking-widest font-mono uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
};

// ---------- Duplicate Alert Modal ----------
const DuplicateModal = ({ record, onClose }) => {
  if (!record) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
         data-testid="duplicate-alert-modal" onClick={onClose}>
      <div className="w-full max-w-2xl bg-black border border-red-500 border-t-4 relative"
           onClick={(e) => e.stopPropagation()}>
        <div className="scanline absolute inset-0" />
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-red-500" strokeWidth={1.5} />
            <div className="font-mono text-red-400 text-sm tracking-[0.25em] uppercase">[!] Collision Detected</div>
          </div>
          <button data-testid="close-duplicate-modal" onClick={onClose} className="text-zinc-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-zinc-300 text-sm leading-relaxed">
            This asset already exists in memory. No new copy has been ingested. Refer to the origin below.
          </p>
          <div className="bg-red-950/30 border border-red-900/50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-red-400">Filename</span>
              <span className="flex-1 h-px bg-red-900/60" />
            </div>
            <div className="font-mono text-white text-sm break-all" data-testid="dup-filename">{record.filename || record.app_name}</div>

            {record.original_path || record.install_path ? (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-red-400">Origin Path</span>
                  <span className="flex-1 h-px bg-red-900/60" />
                </div>
                <div className="font-mono text-red-300 text-xs break-all" data-testid="dup-path">
                  {record.original_path || record.install_path}
                </div>
              </>
            ) : (
              <div className="text-xs text-zinc-500 font-mono italic">// no path metadata provided at ingest</div>
            )}

            {record.sha256 && (
              <>
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-red-400">SHA-256</span>
                  <span className="flex-1 h-px bg-red-900/60" />
                </div>
                <div className="font-mono text-zinc-400 text-[11px] break-all">{record.sha256}</div>
              </>
            )}

            {record.size != null && (
              <div className="text-xs font-mono text-zinc-400 pt-1">SIZE :: {fmtBytes(record.size)}</div>
            )}
            {record.version && (
              <div className="text-xs font-mono text-zinc-400">VERSION :: {record.version}</div>
            )}
          </div>
          <div className="flex justify-end">
            <button data-testid="ack-duplicate"
              onClick={onClose}
              className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.2em]">
              Acknowledge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- Upload Dropzone ----------
const Dropzone = ({ onResult }) => {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(null);
  const [pathHint, setPathHint] = useState("");
  const inputRef = useRef();

  const handleFiles = useCallback(async (files) => {
    for (const f of Array.from(files)) {
      setProcessing({ name: f.name, size: f.size });
      const fd = new FormData();
      fd.append("file", f);
      if (pathHint) fd.append("original_path", pathHint);
      try {
        const { data } = await axios.post(`${API}/files/upload`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        onResult(data);
      } catch (e) {
        console.error(e);
      }
    }
    setProcessing(null);
    setPathHint("");
  }, [onResult, pathHint]);

  return (
    <div className="border border-zinc-800 bg-zinc-950 relative">
      <div className="scanline absolute inset-0 pointer-events-none" />
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-orange-500" strokeWidth={1.5} />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-400">
            &gt; ingest_module.v1
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">SHA-256 · dedup</span>
      </div>

      <div
        data-testid="upload-dropzone"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed m-4 p-10 transition-none text-center ${
          dragOver ? "border-orange-500 bg-orange-500/5" : "border-zinc-700 hover:border-orange-500 hover:bg-orange-500/5"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="upload-input"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        {processing ? (
          <div className="space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-orange-400 flicker">
              &gt; hashing_stream :: {processing.name}
            </div>
            <div className="font-mono text-[10px] text-zinc-500">
              [{fmtBytes(processing.size)}] computing SHA-256<span className="blink">_</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload size={22} strokeWidth={1.25} className="text-zinc-500 mx-auto" />
            <div className="text-lg md:text-xl font-mono uppercase tracking-[0.25em] text-white">DROP FILES</div>
            <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
              or click to select · pdf · doc · audio · video · image · installers
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
          Origin path (optional)
        </label>
        <input
          data-testid="origin-path-input"
          value={pathHint}
          onChange={(e) => setPathHint(e.target.value)}
          placeholder="/Users/you/Downloads/report.pdf"
          className="flex-1 bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs text-white placeholder:text-zinc-600"
        />
      </div>
    </div>
  );
};

// ---------- Stat Card ----------
const StatCard = ({ label, value, sub, testId, tone = "default" }) => {
  const toneCls = tone === "accent" ? "text-orange-400" : tone === "alert" ? "text-red-400" : "text-white";
  return (
    <div className="border border-zinc-800 bg-zinc-950 p-5 relative" data-testid={testId}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.25em] uppercase text-zinc-500 font-mono">{label}</div>
        <div className="h-px w-8 bg-zinc-800" />
      </div>
      <div className={`text-3xl md:text-4xl font-mono font-medium mt-3 tracking-tight ${toneCls}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] font-mono text-zinc-500 mt-1 uppercase tracking-widest">{sub}</div>}
    </div>
  );
};

// ---------- Files Table ----------
const FilesPanel = ({ files, onDelete, query, setQuery, category, setCategory }) => {
  return (
    <div>
      <SectionHeader index="02" title="File Registry" sub={`${files.length} tracked`} />

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="flex-1 flex items-center border-b-2 border-zinc-800 focus-within:border-orange-500">
          <Search size={14} className="text-zinc-500 mr-2" strokeWidth={1.5} />
          <input
            data-testid="global-search-input"
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="search :: filename / hash / path / mime"
            className="bg-transparent w-full py-2 font-mono text-sm text-white placeholder:text-zinc-600" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            data-testid={`filter-chip-${c}`}
            onClick={() => setCategory(c)}
            className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ${
              category === c
                ? "bg-white text-black border-white font-bold"
                : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="border border-zinc-800 overflow-x-auto" data-testid="file-registry-table">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-zinc-800 text-left">
              {["#", "File", "Type", "Size", "SHA-256", "Origin Path", "Added", ""].map((h, i) => (
                <th key={i} className="py-2 px-4 text-[10px] tracking-[0.25em] uppercase text-zinc-500 font-mono">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {files.length === 0 && (
              <tr><td colSpan={8} className="py-16 text-center font-mono text-xs text-zinc-600 uppercase tracking-widest">
                // registry empty · drop a file above to initialize
              </td></tr>
            )}
            {files.map((f, i) => (
              <tr key={f.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-600">{String(i + 1).padStart(3, "0")}</td>
                <td className="py-2 px-4 text-sm text-white truncate max-w-[240px]">{f.filename}</td>
                <td className="py-2 px-4">
                  <Badge tone="default">
                    {catIcon(f.file_category)} {f.file_category}
                  </Badge>
                </td>
                <td className="py-2 px-4 font-mono text-xs text-zinc-400">{fmtBytes(f.size)}</td>
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-500 truncate max-w-[180px]">{f.sha256.slice(0, 20)}…</td>
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-500 truncate max-w-[220px]">{f.original_path || "—"}</td>
                <td className="py-2 px-4 font-mono text-[11px] text-zinc-500">{new Date(f.created_at).toLocaleDateString()}</td>
                <td className="py-2 px-4 text-right">
                  <button
                    data-testid={`delete-file-${f.id}`}
                    onClick={() => onDelete(f.id)}
                    className="text-zinc-500 hover:text-red-400 border border-transparent hover:border-red-500/40 p-1"
                    title="Purge record"
                  >
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

// ---------- Apps Panel ----------
const AppsPanel = ({ apps, refresh, onDup }) => {
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
    } finally {
      setBusy(false);
    }
  };

  const del = async (id) => {
    await axios.delete(`${API}/apps/${id}`);
    refresh();
  };

  const filtered = apps.filter((a) => {
    const matchQ = !q || [a.app_name, a.version, a.install_path].some((x) => x.toLowerCase().includes(q.toLowerCase()));
    const matchP = platform === "all" || a.platform === platform;
    return matchQ && matchP;
  });

  return (
    <div>
      <SectionHeader index="03" title="Application Registry" sub={`${apps.length} installed`} />

      <div className="grid md:grid-cols-5 gap-3 border border-zinc-800 bg-zinc-950 p-5 mb-8" data-testid="app-register-form">
        <input
          data-testid="app-name-input"
          value={form.app_name} onChange={(e) => setForm({ ...form, app_name: e.target.value })}
          placeholder="app_name" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs" />
        <input
          data-testid="app-version-input"
          value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })}
          placeholder="version (e.g. 1.4.2)" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs" />
        <input
          data-testid="app-path-input"
          value={form.install_path} onChange={(e) => setForm({ ...form, install_path: e.target.value })}
          placeholder="/Applications/Foo.app" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs md:col-span-2" />
        <select
          data-testid="app-platform-select"
          value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
          className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs">
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input
          data-testid="app-notes-input"
          value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="notes (optional)" className="bg-black border border-zinc-800 focus:border-orange-500 px-3 py-2 font-mono text-xs md:col-span-4" />
        <button
          data-testid="app-register-submit"
          disabled={busy} onClick={submit}
          className="border border-orange-500 bg-orange-500/10 hover:bg-orange-500 hover:text-black text-orange-400 font-mono text-xs uppercase tracking-[0.2em] px-4 py-2 flex items-center justify-center gap-2">
          <Plus size={14} strokeWidth={1.5} /> Register
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="flex-1 flex items-center border-b-2 border-zinc-800 focus-within:border-orange-500">
          <Search size={14} className="text-zinc-500 mr-2" strokeWidth={1.5} />
          <input
            data-testid="apps-search-input"
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="search apps"
            className="bg-transparent w-full py-2 font-mono text-sm text-white placeholder:text-zinc-600" />
        </div>
        <div className="flex flex-wrap gap-2">
          {["all", ...PLATFORMS].map((p) => (
            <button key={p}
              data-testid={`platform-chip-${p}`}
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
                  <button
                    data-testid={`delete-app-${a.id}`}
                    onClick={() => del(a.id)}
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

// ---------- Dashboard ----------
const Dashboard = ({ stats }) => {
  const categoryOrder = ["pdf", "doc", "audio", "video", "image", "installer", "other"];
  const total = stats?.total_files || 0;
  return (
    <div>
      <SectionHeader index="01" title="System Overview" sub="Real-time memory index" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard testId="stats-total-files" label="Files Tracked" value={stats?.total_files ?? 0} sub="Unique SHA-256" />
        <StatCard testId="stats-total-apps" label="Apps Registered" value={stats?.total_apps ?? 0} sub="Cross-platform" />
        <StatCard testId="stats-duplicates" label="Collisions Blocked" value={stats?.duplicates_prevented ?? 0} tone="alert" sub="Duplicates prevented" />
        <StatCard testId="stats-bytes-saved" label="Memory Saved" value={fmtBytes(stats?.bytes_saved || 0)} tone="accent" sub="Bytes not duplicated" />
      </div>

      <div className="mt-8 border border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-orange-500" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-400">Distribution by category</span>
          </div>
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">
            TOTAL {fmtBytes(stats?.total_bytes_tracked || 0)}
          </span>
        </div>
        <div className="p-5 space-y-3" data-testid="category-distribution">
          {categoryOrder.map((cat) => {
            const c = stats?.by_category?.[cat];
            const count = c?.count || 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={cat} className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                  {catIcon(cat)} {cat}
                </div>
                <div className="col-span-8 h-2 bg-zinc-900 border border-zinc-800">
                  <div className="h-full bg-orange-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="col-span-2 flex justify-between font-mono text-[11px] text-zinc-400">
                  <span>{count}</span>
                  <span className="text-zinc-600">{fmtBytes(c?.bytes || 0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ---------- Main App ----------
function App() {
  const [tab, setTab] = useState("dashboard");
  const [files, setFiles] = useState([]);
  const [apps, setApps] = useState([]);
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [dupRecord, setDupRecord] = useState(null);
  const [flashOk, setFlashOk] = useState(null);
  const [now, setNow] = useState(new Date());

  const loadFiles = useCallback(async () => {
    const { data } = await axios.get(`${API}/files`, { params: { q: query || undefined, category } });
    setFiles(data);
  }, [query, category]);

  const loadApps = useCallback(async () => {
    const { data } = await axios.get(`${API}/apps`);
    setApps(data);
  }, []);

  const loadStats = useCallback(async () => {
    const { data } = await axios.get(`${API}/stats`);
    setStats(data);
  }, []);

  const refreshAll = useCallback(() => {
    loadFiles(); loadApps(); loadStats();
  }, [loadFiles, loadApps, loadStats]);

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleUploadResult = useCallback(async (data) => {
    if (data.duplicate) {
      setDupRecord(data.record);
    } else {
      setFlashOk(data.record.filename);
      setTimeout(() => setFlashOk(null), 2500);
    }
    refreshAll();
  }, [refreshAll]);

  const deleteFile = useCallback(async (id) => {
    await axios.delete(`${API}/files/${id}`);
    refreshAll();
  }, [refreshAll]);

  const tabs = useMemo(() => ([
    { id: "dashboard", label: "Overview", icon: <Cpu size={13} strokeWidth={1.5} /> },
    { id: "files", label: "Files", icon: <FileIcon size={13} strokeWidth={1.5} /> },
    { id: "apps", label: "Applications", icon: <Package size={13} strokeWidth={1.5} /> },
  ]), []);

  return (
    <div className="App min-h-screen grid-bg">
      {/* Top Bar */}
      <header className="border-b border-zinc-800 bg-black/70 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-orange-500 flex items-center justify-center bg-orange-500/10">
              <HardDrive size={16} className="text-orange-400" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase">MonoNode // v1.0</div>
              <div className="text-lg font-bold tracking-tight uppercase">Memory Vault</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
              <span className="w-2 h-2 bg-emerald-500 blink" />
              <span className="uppercase tracking-[0.25em]">ONLINE</span>
            </div>
            <div className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">
              {now.toISOString().split("T")[0]} · {now.toISOString().split("T")[1].split(".")[0]}
            </div>
          </div>
        </div>
      </header>

      {/* Hero band */}
      <section className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-10 grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <div className="font-mono text-[10px] tracking-[0.35em] text-orange-500 uppercase mb-3">
              &gt; single-source-of-truth memory manager
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase leading-[1.05]">
              One file. <span className="text-orange-500">One install.</span>
              <br />Zero duplicates.
            </h1>
            <p className="text-zinc-400 max-w-xl mt-4 text-sm leading-relaxed">
              Every ingest is hashed with SHA-256 and compared against the vault. Collisions are surfaced with their existing origin path — so the copy never happens twice.
            </p>
          </div>
          <div className="border border-zinc-800 bg-black p-5 relative">
            <div className="scanline absolute inset-0" />
            <div className="text-[10px] font-mono tracking-[0.3em] text-zinc-500 uppercase mb-3">Status Feed</div>
            <div className="space-y-2 font-mono text-[11px]">
              <div className="text-emerald-400">&gt; hash_engine :: idle</div>
              <div className="text-zinc-400">&gt; index_sync   :: ok</div>
              <div className="text-zinc-400">&gt; vault_health :: nominal</div>
              <div className="text-orange-400">&gt; policy       :: DEDUP_STRICT</div>
              <div className="text-zinc-600">&gt; awaiting_input<span className="blink">_</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 flex gap-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] border-r border-zinc-800 ${
                tab === t.id ? "text-orange-400 border-b-2 border-b-orange-500 bg-black"
                             : "text-zinc-500 hover:text-white"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Success flash */}
      {flashOk && (
        <div className="fixed bottom-6 right-6 z-40 border border-emerald-500 bg-black px-4 py-3 flex items-center gap-3"
             data-testid="ingest-success-toast">
          <CheckCircle2 size={16} className="text-emerald-400" strokeWidth={1.5} />
          <div className="font-mono text-xs text-emerald-400 uppercase tracking-[0.2em]">
            Ingested :: <span className="text-white normal-case tracking-normal">{flashOk}</span>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-10 space-y-12">
        {tab === "dashboard" && (
          <>
            <Dashboard stats={stats} />
            <Dropzone onResult={handleUploadResult} />
          </>
        )}
        {tab === "files" && (
          <>
            <Dropzone onResult={handleUploadResult} />
            <FilesPanel
              files={files} onDelete={deleteFile}
              query={query} setQuery={setQuery}
              category={category} setCategory={setCategory}
            />
          </>
        )}
        {tab === "apps" && (
          <AppsPanel apps={apps} refresh={refreshAll} onDup={setDupRecord} />
        )}
      </main>

      <footer className="border-t border-zinc-800 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-600">
          <div className="flex items-center gap-2">
            <ShieldAlert size={12} strokeWidth={1.5} />
            <span>Dedup policy :: strict · sha-256 · irreversible</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={12} strokeWidth={1.5} />
            <span>local vault · {stats?.total_files ?? 0} nodes indexed</span>
          </div>
        </div>
      </footer>

      <DuplicateModal record={dupRecord} onClose={() => setDupRecord(null)} />
    </div>
  );
}

export default App;
