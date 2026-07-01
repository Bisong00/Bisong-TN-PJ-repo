import React from "react";
import { Layers } from "lucide-react";
import { catIcon, fmtBytes } from "../lib/api";
import { SectionHeader, StatCard } from "./shared";

export const Dashboard = ({ stats }) => {
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
