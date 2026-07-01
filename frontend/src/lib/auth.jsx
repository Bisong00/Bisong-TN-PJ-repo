import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import axios from "axios";
import { API } from "./api";

const AuthCtx = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("checking"); // checking | anon | authed

  const checkAuth = useCallback(async () => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      return;
    }
    try {
      const { data } = await axios.get(`${API}/auth/me`);
      setUser(data);
      setStatus("authed");
    } catch (_) {
      setUser(null);
      setStatus("anon");
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const login = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const logout = async () => {
    try { await axios.post(`${API}/auth/logout`); } catch (_) {}
    setUser(null);
    setStatus("anon");
    // hard-refresh so any in-memory data is cleared
    window.location.href = "/";
  };

  const setAuthedUser = (u) => { setUser(u); setStatus("authed"); };

  return (
    <AuthCtx.Provider value={{ user, status, login, logout, checkAuth, setAuthedUser }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
};
