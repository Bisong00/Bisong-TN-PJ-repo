import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API } from "../lib/api";
import { useAuth } from "../lib/auth";

export const AuthCallback = () => {
  const { setAuthedUser } = useAuth();
  const processed = useRef(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    (async () => {
      const hash = window.location.hash || "";
      const m = hash.match(/session_id=([^&]+)/);
      if (!m) { window.history.replaceState({}, "", "/"); return; }
      const sessionId = decodeURIComponent(m[1]);
      try {
        const { data } = await axios.post(`${API}/auth/session`, {}, {
          headers: { "X-Session-ID": sessionId },
        });
        setAuthedUser(data);
        // remove the fragment
        window.history.replaceState({}, "", "/");
      } catch (e) {
        setErr("Sign-in failed. Please try again.");
        setTimeout(() => (window.location.href = "/"), 2000);
      }
    })();
  }, [setAuthedUser]);

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center">
      <div className="border border-zinc-800 bg-black p-8 relative min-w-[320px]" data-testid="auth-callback">
        <div className="scanline absolute inset-0 pointer-events-none" />
        <div className="font-mono text-[10px] tracking-[0.3em] text-orange-500 uppercase mb-2">
          &gt; establishing_session
        </div>
        <div className="text-lg font-bold tracking-tight uppercase">Signing you in…</div>
        <div className="mt-4 font-mono text-[11px] text-zinc-500 flicker">
          &gt; verifying token · exchanging credentials<span className="blink">_</span>
        </div>
        {err && <div className="mt-3 font-mono text-[11px] text-red-400">[!] {err}</div>}
      </div>
    </div>
  );
};
