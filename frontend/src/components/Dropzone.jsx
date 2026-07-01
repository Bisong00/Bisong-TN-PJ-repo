import React, { useCallback, useRef, useState } from "react";
import axios from "axios";
import { Upload, Terminal } from "lucide-react";
import { API, fmtBytes } from "../lib/api";

export const Dropzone = ({ onResult }) => {
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
      } catch (e) { console.error(e); }
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
          ref={inputRef} type="file" multiple className="hidden"
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
