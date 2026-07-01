import React from "react";
import { Search, Trash2, Download } from "lucide-react";
import { API, CATEGORIES, catIcon, fmtBytes } from "../lib/api";
import { SectionHeader, Badge } from "./shared";

export const FilesPanel = ({ files, onDelete, query, setQuery, category, setCategory }) => (
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
      <div className="flex gap-2">
        <a data-testid="export-files-csv" href={`${API}/files/export?format=csv`}
           className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 text-zinc-300 font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-2 flex items-center gap-1">
          <Download size={12} strokeWidth={1.5} /> CSV
        </a>
        <a data-testid="export-files-json" href={`${API}/files/export?format=json`}
           className="border border-zinc-700 hover:border-orange-500 hover:text-orange-400 text-zinc-300 font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-2 flex items-center gap-1">
          <Download size={12} strokeWidth={1.5} /> JSON
        </a>
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
        >{c}</button>
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
                <Badge tone="default">{catIcon(f.file_category)} {f.file_category}</Badge>
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
