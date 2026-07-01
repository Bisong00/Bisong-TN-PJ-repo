import React, { useCallback, useEffect, useMemo, useState } from "react";
import "@/App.css";
import axios from "axios";
import {
  Cpu, File as FileIcon, HardDrive, Package, Radar, Link2,
  ShieldAlert, MapPin, CheckCircle2,
} from "lucide-react";
import { API } from "./lib/api";
import { Dropzone } from "./components/Dropzone";
import { FilesPanel } from "./components/FilesPanel";
import { AppsPanel } from "./components/AppsPanel";
import { ScanPanel } from "./components/ScanPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { Dashboard } from "./components/Dashboard";
import { DuplicateModal } from "./components/DuplicateModal";

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
  const loadApps = useCallback(async () => { const { data } = await axios.get(`${API}/apps`); setApps(data); }, []);
  const loadStats = useCallback(async () => { const { data } = await axios.get(`${API}/stats`); setStats(data); }, []);
  const refreshAll = useCallback(() => { loadFiles(); loadApps(); loadStats(); }, [loadFiles, loadApps, loadStats]);

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const handleUploadResult = useCallback((data) => {
    if (data.duplicate) {
      setDupRecord(data.record);
    } else {
      setFlashOk(data.record.filename);
      setTimeout(() => setFlashOk(null), 2500);
    }
    refreshAll();
  }, [refreshAll]);

  const deleteFile = useCallback(async (id) => { await axios.delete(`${API}/files/${id}`); refreshAll(); }, [refreshAll]);

  const tabs = useMemo(() => ([
    { id: "dashboard", label: "Overview", icon: <Cpu size={13} strokeWidth={1.5} /> },
    { id: "files", label: "Files", icon: <FileIcon size={13} strokeWidth={1.5} /> },
    { id: "scan", label: "Full Scan", icon: <Radar size={13} strokeWidth={1.5} /> },
    { id: "duplicates", label: "Duplicates", icon: <Link2 size={13} strokeWidth={1.5} /> },
    { id: "apps", label: "Applications", icon: <Package size={13} strokeWidth={1.5} /> },
  ]), []);

  return (
    <div className="App min-h-screen grid-bg">
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
            <div className="scanline absolute inset-0 pointer-events-none" />
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

      <nav className="border-b border-zinc-800">
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

      {flashOk && (
        <div className="fixed bottom-6 right-6 z-40 border border-emerald-500 bg-black px-4 py-3 flex items-center gap-3"
             data-testid="ingest-success-toast">
          <CheckCircle2 size={16} className="text-emerald-400" strokeWidth={1.5} />
          <div className="font-mono text-xs text-emerald-400 uppercase tracking-[0.2em]">
            Ingested :: <span className="text-white normal-case tracking-normal">{flashOk}</span>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-12">
        {tab === "dashboard" && (<><Dashboard stats={stats} /><Dropzone onResult={handleUploadResult} /></>)}
        {tab === "files" && (
          <>
            <Dropzone onResult={handleUploadResult} />
            <FilesPanel files={files} onDelete={deleteFile}
              query={query} setQuery={setQuery}
              category={category} setCategory={setCategory} />
          </>
        )}
        {tab === "scan" && <ScanPanel refreshAll={refreshAll} />}
        {tab === "duplicates" && <DuplicatesPanel refreshAll={refreshAll} />}
        {tab === "apps" && <AppsPanel apps={apps} refresh={refreshAll} onDup={setDupRecord} />}
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
