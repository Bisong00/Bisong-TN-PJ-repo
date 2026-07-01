import React from "react";

export const SectionHeader = ({ index, title, sub }) => (
  <div className="flex items-end justify-between border-b border-zinc-800 pb-3 mb-6">
    <div>
      <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 font-mono">SECTION / {index}</div>
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight uppercase mt-1">{title}</h2>
    </div>
    {sub && <div className="hidden md:block text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500">{sub}</div>}
  </div>
);

export const Badge = ({ children, tone = "default", testId }) => {
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

export const StatCard = ({ label, value, sub, testId, tone = "default" }) => {
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
