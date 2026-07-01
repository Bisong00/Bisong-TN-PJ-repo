import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

const ToastCtx = createContext(null);
let counter = 0;

export const ToastProvider = ({ children }) => {
  const [items, setItems] = useState([]);
  const timers = useRef({});

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
  }, []);

  const push = useCallback((msg, tone = "info", ttl = 3500) => {
    const id = ++counter;
    setItems((prev) => [...prev, { id, msg, tone }]);
    timers.current[id] = setTimeout(() => remove(id), ttl);
    return id;
  }, [remove]);

  const api = {
    ok: (m, t) => push(m, "ok", t),
    err: (m, t) => push(m, "err", t ?? 5000),
    info: (m, t) => push(m, "info", t),
    push,
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-6 right-6 z-[60] flex flex-col gap-2" data-testid="toast-container">
        {items.map((t) => {
          const tone = t.tone === "ok" ? "border-emerald-500 text-emerald-400"
                     : t.tone === "err" ? "border-red-500 text-red-400"
                     : "border-orange-500 text-orange-400";
          const Icon = t.tone === "ok" ? CheckCircle2 : t.tone === "err" ? AlertTriangle : Info;
          return (
            <div key={t.id} data-testid={`toast-${t.tone}`}
              className={`border ${tone} bg-black px-4 py-3 flex items-start gap-3 min-w-[260px] max-w-md`}>
              <Icon size={14} strokeWidth={1.5} className="mt-[2px] shrink-0" />
              <div className="flex-1 font-mono text-[11px] uppercase tracking-[0.2em] break-words">{t.msg}</div>
              <button onClick={() => remove(t.id)} className="text-zinc-500 hover:text-white shrink-0">
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
};

export const useToast = () => {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast must be inside ToastProvider");
  return v;
};
