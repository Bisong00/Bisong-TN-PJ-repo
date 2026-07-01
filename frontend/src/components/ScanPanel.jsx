import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { FolderSearch, Download, Copy, Radar, HardDrive, CheckCircle2, Key, Plus, Trash2 } from "lucide-react";
import { API, BACKEND_URL, fmtBytes } from "../lib/api";
import { SectionHeader, Badge } from "./shared";
import { useToast } from "./Toast";

async function hashFileSHA256(file) {
  const buf = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buf);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ScanPanel = ({ refreshAll }) => {
  const inputRef = useRef();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState("mac");
  const [tokens, setTokens] = useState([]);
  const [freshToken, setFreshToken] = useState("");
  const toast = useToast();

  const loadTokens = async () => {
    try {
      const { data } = await axios.get(`${API}/auth/agent-token`);
      setTokens(data || []);
    } catch (_) {}
  };
  useEffect(() => { loadTokens(); }, []);

  const generateToken = async () => {
    try {
      const { data } = await axios.post(`${API}/auth/agent-token`);
      setFreshToken(data.token);
      toast.ok("Agent token generated");
      loadTokens();
    } catch (e) { toast.err("Token generation failed"); }
  };

  const revokeToken = async (t) => {
    try {
      await axios.delete(`${API}/auth/agent-token/${t}`);
      toast.info("Token revoked");
      if (freshToken === t) setFreshToken("");
      loadTokens();
    } catch (e) { toast.err("Revoke failed"); }
  };

  const tokenForCmd = freshToken || "<YOUR_AGENT_TOKEN>";

  const commands = {
    mac: `# Mac / Linux — scan your entire home folder
curl -o monoscan.py "${API}/agent/monoscan.py?request_backend=${encodeURIComponent(BACKEND_URL)}"
pip3 install requests

# One-shot scan (paste your agent token below)
python3 monoscan.py --root ~ --token ${tokenForCmd}

# Continuous watch mode
python3 monoscan.py --root ~ --token ${tokenForCmd} --watch

# Enforce one-instance-on-disk: replace duplicates with symlinks
python3 monoscan.py --root ~ --token ${tokenForCmd} --replace-duplicates --yes`,
    windows: `# Windows PowerShell — scan your entire C: drive
Invoke-WebRequest -Uri "${API}/agent/monoscan.py?request_backend=${encodeURIComponent(BACKEND_URL)}" -OutFile monoscan.py
pip install requests

# One-shot scan
python monoscan.py --root C:\\ --token ${tokenForCmd}

# Continuous watch mode
python monoscan.py --root C:\\Users\\$env:USERNAME --token ${tokenForCmd} --watch

# Enforce one-instance-on-disk: replace duplicates with symlinks
# (Windows: enable Developer Mode or run PowerShell as admin for symlink perms)
python monoscan.py --root C:\\Users\\$env:USERNAME --token ${tokenForCmd} --replace-duplicates --yes`,
    linux: `# Linux — scan the whole disk (sudo for system dirs)
curl -o monoscan.py "${API}/agent/monoscan.py?request_backend=${encodeURIComponent(BACKEND_URL)}"
pip3 install requests

# One-shot scan
python3 monoscan.py --root / --token ${tokenForCmd}

# Continuous watch mode
python3 monoscan.py --root ~ --token ${tokenForCmd} --watch

# Enforce one-instance-on-disk: replace duplicates with symlinks
python3 monoscan.py --root ~ --token ${tokenForCmd} --replace-duplicates --yes`,
  };

  const runBrowserScan = async (fileList) => {
    const files = Array.from(fileList);
    setResult(null);
    setScanning(true);
    setProgress({ done: 0, total: files.length, current: "" });

    let batch = [];
    let rootLabel = "";
    let finalResult = { scanned: 0, added: 0, duplicates: 0, bytes_saved: 0, duplicate_details: [] };

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const relPath = f.webkitRelativePath || f.name;
      if (i === 0) rootLabel = relPath.split("/")[0] || "";
      setProgress({ done: i, total: files.length, current: relPath });
      try {
        if (f.size === 0) continue;
        if (f.size > 500 * 1024 * 1024) continue;
        const sha256 = await hashFileSHA256(f);
        batch.push({
          filename: f.name, size: f.size, sha256,
          relative_path: relPath, mime_type: f.type || "",
        });
      } catch (e) { console.warn("hash failed", relPath, e); }

      if (batch.length >= 200) {
        try {
          const { data } = await axios.post(`${API}/files/scan`, {
            items: batch.splice(0, batch.length), root_label: rootLabel, source: "browser",
          });
          finalResult.scanned += data.scanned;
          finalResult.added += data.added;
          finalResult.duplicates += data.duplicates;
          finalResult.bytes_saved += data.bytes_saved;
          finalResult.duplicate_details.push(...(data.duplicate_details || []));
        } catch (e) { console.error(e); }
      }
    }
    if (batch.length) {
      try {
        const { data } = await axios.post(`${API}/files/scan`, {
          items: batch, root_label: rootLabel, source: "browser",
        });
        finalResult.scanned += data.scanned;
        finalResult.added += data.added;
        finalResult.duplicates += data.duplicates;
        finalResult.bytes_saved += data.bytes_saved;
        finalResult.duplicate_details.push(...(data.duplicate_details || []));
      } catch (e) { console.error(e); }
    }
    setProgress({ done: files.length, total: files.length, current: "complete" });
    setResult(finalResult);
    setScanning(false);
    toast.ok(`Scan done · ${finalResult.added} added · ${finalResult.duplicates} duplicates`);
    refreshAll();
  };

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(commands[platform]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  return (
    <div>
      <SectionHeader index="04" title="Full Scan" sub="Whole-folder · whole-disk dedup" />

      <div className="border border-zinc-800 bg-zinc-950 mb-8" data-testid="scan-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <FolderSearch size={14} className="text-orange-500" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-400">
              &gt; folder_scan.browser
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">recursive · sha-256 client-side</span>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Pick any folder (Downloads, Documents, or your entire user directory). The browser will
            recursively hash every file inside <span className="text-orange-400">without uploading contents</span>.
            Only SHA-256 hashes leave your machine.
          </p>

          <div className="flex flex-wrap gap-3 items-center">
            <input ref={inputRef} type="file" className="hidden"
              webkitdirectory="true" directory="" multiple
              data-testid="scan-folder-input"
              onChange={(e) => e.target.files && runBrowserScan(e.target.files)} />
            <button data-testid="scan-folder-btn" disabled={scanning}
              onClick={() => inputRef.current?.click()}
              className="border border-orange-500 bg-orange-500/10 hover:bg-orange-500 hover:text-black text-orange-400 font-mono text-xs uppercase tracking-[0.2em] px-4 py-2 flex items-center gap-2 disabled:opacity-50">
              <Radar size={14} strokeWidth={1.5} />
              {scanning ? "SCANNING…" : "PICK FOLDER · START SCAN"}
            </button>
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              {scanning ? `${progress.done}/${progress.total}` : "waiting for target"}
            </span>
          </div>

          {scanning && (
            <div className="space-y-2" data-testid="scan-progress">
              <div className="h-1 bg-zinc-900 border border-zinc-800">
                <div className="h-full bg-orange-500 transition-none"
                     style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <div className="font-mono text-[10px] text-zinc-500 truncate">
                hashing :: <span className="text-orange-400">{progress.current}</span>
              </div>
            </div>
          )}

          {result && !scanning && (
            <div className="border border-zinc-800 bg-black p-4 space-y-3" data-testid="scan-result">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-400">&gt; scan_complete</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-zinc-800 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Scanned</div>
                  <div className="font-mono text-2xl">{result.scanned}</div>
                </div>
                <div className="border border-zinc-800 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Unique added</div>
                  <div className="font-mono text-2xl text-emerald-400">{result.added}</div>
                </div>
                <div className="border border-zinc-800 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Duplicates</div>
                  <div className="font-mono text-2xl text-red-400">{result.duplicates}</div>
                </div>
                <div className="border border-zinc-800 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Memory saved</div>
                  <div className="font-mono text-2xl text-orange-400">{fmtBytes(result.bytes_saved)}</div>
                </div>
              </div>
              {result.duplicate_details?.length > 0 && (
                <div className="border border-red-900/40 overflow-x-auto">
                  <div className="px-4 py-2 border-b border-red-900/40 font-mono text-[10px] uppercase tracking-[0.25em] text-red-400 bg-red-950/20">
                    [!] Collisions found — existing copies below (see Duplicates tab to reclaim)
                  </div>
                  <table className="w-full min-w-[700px]">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        {["Duplicate at", "Already lives at", "Size", "Reason"].map((h, i) => (
                          <th key={i} className="py-2 px-3 text-left text-[10px] tracking-widest uppercase text-zinc-500 font-mono">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.duplicate_details.slice(0, 100).map((d, i) => (
                        <tr key={i} className="border-b border-zinc-900">
                          <td className="py-2 px-3 font-mono text-[11px] text-red-300 truncate max-w-[260px]">{d.scanned_path}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-emerald-400 truncate max-w-[260px]">{d.existing_path}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-zinc-400">{fmtBytes(d.size)}</td>
                          <td className="py-2 px-3"><Badge tone={d.reason === "vault_match" ? "alert" : "accent"}>{d.reason}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border border-zinc-800 bg-zinc-950 mb-8" data-testid="agent-token-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Key size={14} className="text-orange-500" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-400">
              &gt; agent_token · authenticate the cli
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">
            {tokens.length} active
          </span>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-zinc-300 leading-relaxed">
            The MonoScan CLI needs a per-user token to write to <span className="text-orange-400">your</span> vault.
            Generate one, paste it into the command block below (already interpolated), then run the agent on your machine.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button data-testid="agent-token-generate" onClick={generateToken}
              className="border border-orange-500 bg-orange-500/10 hover:bg-orange-500 hover:text-black text-orange-400 font-mono text-xs uppercase tracking-[0.2em] px-3 py-2 flex items-center gap-2">
              <Plus size={13} strokeWidth={1.5} /> Generate new token
            </button>
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              7-day session bound · revocable · never expires unless revoked
            </span>
          </div>

          {freshToken && (
            <div className="border border-emerald-500 bg-emerald-500/5 p-3" data-testid="agent-token-display">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-400 mb-1">
                [✓] new_token · shown once · treat like a password
              </div>
              <div className="font-mono text-[11px] text-white break-all">{freshToken}</div>
            </div>
          )}

          {tokens.length > 0 && (
            <div className="border border-zinc-800">
              <div className="px-3 py-2 border-b border-zinc-800 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                Active tokens
              </div>
              {tokens.map((t) => (
                <div key={t.token} className="flex items-center justify-between px-3 py-2 border-b border-zinc-900 last:border-b-0">
                  <div className="font-mono text-[11px] text-zinc-400 truncate">
                    {t.token.slice(0, 12)}…{t.token.slice(-6)}
                    <span className="ml-3 text-zinc-600">created {new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                  <button data-testid={`agent-token-revoke-${t.token.slice(0, 8)}`}
                    onClick={() => revokeToken(t.token)}
                    className="text-zinc-500 hover:text-red-400 border border-transparent hover:border-red-500/40 p-1"
                    title="Revoke token">
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border border-zinc-800 bg-zinc-950" data-testid="agent-panel">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <HardDrive size={14} className="text-orange-500" strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-400">
              &gt; monoscan.agent · whole-computer
            </span>
          </div>
          <span className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">runs locally · full disk access</span>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            For a <span className="text-orange-400">whole-computer scan</span> (including system folders the
            browser cannot reach), run the MonoScan agent on your machine. It's a single Python file that
            recursively walks your entire drive, hashes every file, and reports duplicates back to this vault.
          </p>

          <div className="flex flex-wrap gap-2">
            {[{ id: "mac", label: "Mac" }, { id: "windows", label: "Windows" }, { id: "linux", label: "Linux" }].map((p) => (
              <button key={p.id} data-testid={`agent-os-${p.id}`}
                onClick={() => setPlatform(p.id)}
                className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ${
                  platform === p.id ? "bg-white text-black border-white font-bold"
                                    : "border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-500"
                }`}>{p.label}</button>
            ))}
          </div>

          <div className="relative bg-black border border-zinc-800">
            <pre className="p-4 font-mono text-[11px] text-emerald-400 overflow-x-auto whitespace-pre" data-testid="agent-command">
{commands[platform]}
            </pre>
            <button data-testid="agent-copy-btn" onClick={copyCmd}
              className="absolute top-2 right-2 border border-zinc-700 hover:border-orange-500 text-zinc-400 hover:text-orange-400 p-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest">
              {copied ? <><CheckCircle2 size={12} strokeWidth={1.5} /> copied</> : <><Copy size={12} strokeWidth={1.5} /> copy</>}
            </button>
          </div>

          <div className="flex gap-3 flex-wrap">
            <a data-testid="agent-download-link"
              href={`${API}/agent/monoscan.py?request_backend=${encodeURIComponent(BACKEND_URL)}`}
              className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 text-zinc-300 font-mono text-xs uppercase tracking-[0.2em] px-4 py-2 flex items-center gap-2">
              <Download size={14} strokeWidth={1.5} /> Download monoscan.py
            </a>
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest self-center">
              &gt; requires python 3.8+ · needs `requests` (pip install requests)
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-3 space-y-1 text-[11px] font-mono text-zinc-500">
            <div>[i] Only SHA-256 hashes + filenames are sent — file contents never leave your machine.</div>
            <div>[i] Skips hidden folders, node_modules, .git, System Volume Information, $RECYCLE.BIN by default.</div>
            <div>[i] <span className="text-orange-400">--watch</span> keeps running and hashes new files as they arrive (auto-dedup on downloads).</div>
            <div>[i] <span className="text-orange-400">--replace-duplicates</span> deletes duplicates and replaces them with symlinks to the canonical copy — real OS-level enforcement.</div>
            <div>[i] Schedule with cron / launchd (Mac/Linux) or Task Scheduler (Windows) for continuous dedup.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
