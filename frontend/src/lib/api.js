import axios from "axios";
import React from "react";
import { FileText, FileAudio, FileVideo, Image as ImageIcon, Package, File as FileIcon } from "lucide-react";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Global axios: send cookies with every request (needed for session_token)
axios.defaults.withCredentials = true;

export const fmtBytes = (b) => {
  if (b === 0 || b == null) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};

export const catIcon = (c) => {
  const p = { size: 14, strokeWidth: 1.5 };
  switch (c) {
    case "pdf":
    case "doc": return <FileText {...p} />;
    case "audio": return <FileAudio {...p} />;
    case "video": return <FileVideo {...p} />;
    case "image": return <ImageIcon {...p} />;
    case "installer": return <Package {...p} />;
    default: return <FileIcon {...p} />;
  }
};

export const CATEGORIES = ["all", "pdf", "doc", "audio", "video", "image", "installer", "other"];
export const PLATFORMS = ["windows", "mac", "linux", "android", "ios"];
