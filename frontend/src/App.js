import React, { useCallback, useEffect, useMemo, useState } from "react";
import "@/App.css";
import axios from "axios";
import {
  Cpu, File as FileIcon, HardDrive, Package, Radar, Link2,
  ShieldAlert, MapPin, LogOut, Zap, X,
} from "lucide-react";
import { API } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider, useToast } from "./components/Toast";
import { Dropzone } from "./components/Dropzone";
import { FilesPanel } from "./components/FilesPanel";
import { AppsPanel } from "./components/AppsPanel";
import { ScanPanel } from "./components/ScanPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { Dashboard } from "./components/Dashboard";
import { DuplicateModal } from "./components/DuplicateModal";
import { LoginPage } from "./components/LoginPage";
import { AuthCallback } from "./components/AuthCallback";

const REFRESH_MS = 12000;

function VaultApp() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState("dashboard");
  const [files, setFiles] = useState([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [apps, setApps] = useState([]);
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [dupRecord, setDupRecord] = useState(null);
  const [now, setNow] = useState(new Date());
  const [hideOnboarding, setHideOnboarding] = useState(() => {
    try { return localStorage.getItem("mn_onb_v1") === "done"; } catch { return false; }
  });

  const loadFiles = useCallback(async () => {
    const { data } = await axios.get(`${API}/files`, {
      params: { q: query || undefined, category, limit: 200 },
    });
    setFiles(data.items || []);
    setFilesTotal(data.total || 0);
  }, [query, category]);

  const loadApps = useCallback(async () => {
    const { data } = await axios.get(`${API}/apps`, { params: { limit: 200 } });
    setApps(data.items || []);
  }, []);

  const loadStats = useCallback(async () => {
    const { data } = await axios.get(`${API}/stats`);
    setStats(data);
  }, []);

  const refreshAll = useCallback(() => { loadFiles(); loadApps(); loadStats(); }, [loadFiles, loadApps, loadStats]);

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // Background polling for near-real-time updates (agent uploads)
  useEffect(() => {
    const t = setInterval(() => { loadStats(); if (tab === "files") loadFiles(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadStats, loadFiles, tab]);

  const handleUploadResult = useCallback((data) => {
    if (data.duplicate) {
      setDupRecord(data.record);
      toast.err(`Duplicate blocked :: ${data.record.filename}`);
    } else {
      toast.ok(`Ingested :: ${data.record.filename}`);
    }
    refreshAll();
  }, [refreshAll, toast]);

  const deleteFile = useCallback(async (id) => {
    await axios.delete(`${API}/files/${id}`);
    toast.info("File purged");
    refreshAll();
  }, [refreshAll, toast]);

  const dismissOnboarding = () => {
    setHideOnboarding(true);
    try { localStorage.setItem("mn_onb_v1", "done"); } catch {}
  };

  const tabs = useMemo(() => ([
    { id: "dashboard", label: "Overview", icon: <Cpu size={13} strokeWidth={1.5} /> },
    { id: "files", label: "Files", icon: <FileIcon size={13} strokeWidth={1.5} /> },
    { id: "scan", label: "Full Scan", icon: <Radar size={13} strokeWidth={1.5} /> },
    { id: "duplicates", label: "Duplicates", icon: <Link2 size={13} strokeWidth={1.5} /> },
    { id: "apps", label: "Applications", icon: <Package size={13} strokeWidth={1.5} /> },
  ]), []);

  const empty = (stats?.total_files ?? 0) === 0 && (stats?.total_apps ?? 0) === 0;

  return (
    <div className="App min-h-screen grid-bg">
      <header className="border-b border-zinc-800 bg-black/70 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-orange-500 flex items-center justify-center bg-orange-500/10">
              <HardDrive size={16} className="text-orange-400" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase">MonoNode // v1.0</div>
              <div className="text-base md:text-lg font-bold tracking-tight uppercase">Memory Vault</div>
            </div>
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] text-zinc-400">
              <span className="w-2 h-2 bg-emerald-500 blink" />
              <span className="uppercase tracking-[0.25em]">ONLINE</span>
            </div>
            <div className="hidden xl:block font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">
              {now.toISOString().split("T")[0]} · {now.toISOString().split("T")[1].split(".")[0]}
            </div>
            <div className="flex items-center gap-2 border border-zinc-800 pl-2 pr-1 py-1" data-testid="user-badge">
              {user?.picture ? (
                <img src={user.picture} alt="" className="w-6 h-6 object-cover" />
              ) : (
                <div className="w-6 h-6 bg-orange-500/20 border border-orange-500 flex items-center justify-center font-mono text-[10px] text-orange-400">
                  {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="hidden md:block leading-tight">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white truncate max-w-[140px]">{user?.name || "operator"}</div>
                <div className="font-mono text-[9px] text-zinc-500 truncate max-w-[140px]">{user?.email}</div>
              </div>
              <button data-testid="logout-btn" onClick={logout}
                className="text-zinc-500 hover:text-red-400 border border-transparent hover:border-red-500/40 p-1 ml-1"
                title="Sign out">
                <LogOut size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {!hideOnboarding && empty && (
        <div className="border-b border-orange-500/40 bg-orange-500/5" data-testid="onboarding-banner">
          <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row items-start md:items-center gap-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-orange-400">
              <Zap size={13} strokeWidth={1.5} /> First-run · pick a starting point
            </div>
            <div className="flex-1 text-sm text-zinc-300">
              Your vault is empty. Drop a file into <button data-testid="onb-goto-files" onClick={() => setTab("files")} className="underline text-orange-400 hover:text-orange-300">Files</button>, run a browser scan in <button data-testid="onb-goto-scan" onClick={() => setTab("scan")} className="underline text-orange-400 hover:text-orange-300">Full Scan</button>, or generate an agent token for a whole-computer sweep.
            </div>
            <button data-testid="onb-dismiss" onClick={dismissOnboarding}
              className="border border-zinc-800 hover:border-orange-500 text-zinc-500 hover:text-orange-400 p-1">
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <section className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-8 md:py-10 grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <div className="font-mono text-[10px] tracking-[0.35em] text-orange-500 uppercase mb-3">
              &gt; single-source-of-truth memory manager
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight uppercase leading-[1.05]">
              One file. <span className="text-orange-500">One install.</span>
              <br />Zero duplicates.
            </h1>
            <p className="text-zinc-400 max-w-xl mt-4 text-sm leading-relaxed">
              Every ingest is hashed with SHA-256 and compared against the vault. Collisions are surfaced with their existing origin path — so the copy never happens twice.
            </p>
          </div>
          <div className="border border-zinc-800 bg-black p-5 relative">
            <div className="scanline absolute inset-0 pointer-events-none" />
            <div className="text-[10px] font-mono tracking-[0.3em] text-zinc-500 uppercase mb-3">Status Feed</div>
            <div className="space-y-2 font-mono text-[11px]">
              <div className="text-emerald-400">&gt; hash_engine :: idle</div>
              <div className="text-zinc-400">&gt; index_sync  :: {stats?.total_files ?? 0} files</div>
              <div className="text-zinc-400">&gt; vault_health :: nominal</div>
              <div className="text-orange-400">&gt; policy      :: DEDUP_STRICT</div>
              <div className="text-zinc-600">&gt; awaiting_input<span className="blink">_</span></div>
            </div>
          </div>
        </div>
      </section>

      <nav className="border-b border-zinc-800 sticky top-[57px] z-20 bg-black/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 flex gap-0 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
              className={`px-5 py-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] border-r border-zinc-800 whitespace-nowrap ${
                tab === t.id ? "text-orange-400 border-b-2 border-b-orange-500 bg-black"
                             : "text-zinc-500 hover:text-white"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-12">
        {tab === "dashboard" && (<><Dashboard stats={stats} /><Dropzone onResult={handleUploadResult} /></>)}
        {tab === "files" && (
          <>
            <Dropzone onResult={handleUploadResult} />
            <FilesPanel files={files} total={filesTotal} onDelete={deleteFile}
              query={query} setQuery={setQuery}
              category={category} setCategory={setCategory} />
          </>
        )}
        {tab === "scan" && <ScanPanel refreshAll={refreshAll} />}
        {tab === "duplicates" && <DuplicatesPanel refreshAll={refreshAll} />}
        {tab === "apps" && <AppsPanel apps={apps} refresh={refreshAll} onDup={setDupRecord} />}
      </main>

      <footer className="border-t border-zinc-800 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-600 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={12} strokeWidth={1.5} />
            <span>Dedup policy :: strict · sha-256 · irreversible</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={12} strokeWidth={1.5} />
            <span>vault of {user?.email || "you"} · {stats?.total_files ?? 0} nodes</span>
          </div>
        </div>
      </footer>

      <DuplicateModal record={dupRecord} onClose={() => setDupRecord(null)} />
    </div>
  );
}

function Gate() {
  const { user, status } = useAuth();

  // Handle OAuth callback first — synchronous check to prevent race conditions.
  if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }

  if (status === "checking") {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500 flicker">
          &gt; checking session<span className="blink">_</span>
        </div>
      </div>
    );
  }
  if (status === "anon" || !user) return <LoginPage />;
  return <VaultApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  );
}
