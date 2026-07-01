import React from "react";
import { HardDrive, ShieldCheck, Zap, Radar, Link2 } from "lucide-react";
import { useAuth } from "../lib/auth";

export const LoginPage = () => {
  const { login } = useAuth();
  return (
    <div className="min-h-screen grid-bg flex flex-col">
      <header className="border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-orange-500 flex items-center justify-center bg-orange-500/10">
              <HardDrive size={16} className="text-orange-400" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 uppercase">MonoNode // v1.0</div>
              <div className="text-lg font-bold tracking-tight uppercase">Memory Vault</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-zinc-400">
            <span className="w-2 h-2 bg-emerald-500 blink" />
            <span className="uppercase tracking-[0.25em]">SYSTEM ONLINE</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="font-mono text-[10px] tracking-[0.35em] text-orange-500 uppercase mb-3">
              &gt; single-source-of-truth memory manager
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight uppercase leading-[1.02]">
              One file.<br/>
              <span className="text-orange-500">One install.</span><br/>
              Zero duplicates.
            </h1>
            <p className="text-zinc-400 max-w-lg mt-6 text-sm leading-relaxed">
              Every download, every install, every media file — hashed with SHA-256 and enforced against a personal vault. No copy happens twice on your machine.
            </p>

            <div className="mt-8">
              <button
                data-testid="google-signin-btn"
                onClick={login}
                className="group border-2 border-orange-500 bg-orange-500 hover:bg-orange-400 text-black font-mono text-xs uppercase tracking-[0.25em] px-6 py-3 flex items-center gap-3">
                <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#fff" d="M12 10.2v3.6h5.15c-.23 1.4-.94 2.58-2 3.37v2.8h3.22c1.9-1.75 3-4.34 3-7.53 0-.75-.07-1.47-.2-2.24H12z"/>
                  <path fill="#fff" d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.22-2.8c-.9.6-2.03.94-3.4.94-2.62 0-4.83-1.77-5.63-4.15H3.05v2.6C4.7 19.4 8.1 22 12 22z"/>
                  <path fill="#fff" d="M6.37 13.57c-.2-.6-.32-1.24-.32-1.9 0-.67.12-1.32.32-1.92v-2.6H3.05C2.38 8.55 2 10.23 2 12s.38 3.45 1.05 4.85l3.32-2.6z"/>
                  <path fill="#fff" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.86C16.97 2.98 14.7 2 12 2 8.1 2 4.7 4.6 3.05 7.15l3.32 2.6C7.17 7.72 9.38 5.95 12 5.95z"/>
                </svg>
                Continue with Google
              </button>
              <div className="mt-3 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.2em]">
                &gt; secured by emergent auth · 7-day session
              </div>
            </div>
          </div>

          <div className="border border-zinc-800 bg-black p-6 relative">
            <div className="scanline absolute inset-0 pointer-events-none" />
            <div className="text-[10px] font-mono tracking-[0.3em] text-zinc-500 uppercase mb-4">What you get</div>
            <ul className="space-y-4">
              {[
                { icon: <ShieldCheck size={14} strokeWidth={1.5} />, text: "SHA-256 dedup for every file type — PDF, docs, media, installers" },
                { icon: <Radar size={14} strokeWidth={1.5} />, text: "Whole-computer scan via the MonoScan CLI agent" },
                { icon: <Link2 size={14} strokeWidth={1.5} />, text: "One-click 'Reclaim Everything' scripts that symlink duplicates" },
                { icon: <Zap size={14} strokeWidth={1.5} />, text: "Real-time collision alerts as new files arrive" },
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-3 font-mono text-[11px] text-zinc-300 leading-relaxed">
                  <span className="text-orange-400 mt-[2px]">{f.icon}</span>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-4 border-t border-zinc-800 font-mono text-[10px] text-zinc-500 uppercase tracking-widest space-y-1">
              <div className="text-emerald-400">&gt; policy       :: DEDUP_STRICT</div>
              <div>&gt; file_bytes  :: never leave your machine</div>
              <div>&gt; only hashes :: transit the wire</div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
          &gt; awaiting authentication
        </div>
      </footer>
    </div>
  );
};
