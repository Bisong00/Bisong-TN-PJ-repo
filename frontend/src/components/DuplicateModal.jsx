import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { fmtBytes } from "../lib/api";

export const DuplicateModal = ({ record, onClose }) => {
  if (!record) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
         data-testid="duplicate-alert-modal" onClick={onClose}>
      <div className="w-full max-w-2xl bg-black border border-red-500 border-t-4 relative"
           onClick={(e) => e.stopPropagation()}>
        <div className="scanline absolute inset-0 pointer-events-none" />
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
            <div className="font-mono text-white text-sm break-all" data-testid="dup-filename">
              {record.filename || record.app_name}
            </div>

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
