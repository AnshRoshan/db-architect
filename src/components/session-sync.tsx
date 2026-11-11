"use client";

import { useEffect } from "react";
import { installFetchInterceptor, setToken, UNAUTHORIZED_EVENT } from "@/lib/client-session";

/**
 * Installs the bearer-token transport for API calls. Rendered once at the root
 * so every page — landing, auth, and the workspace — shares it.
 */
export default function SessionSync() {
  useEffect(() => {
    const uninstall = installFetchInterceptor();
    const onAuth = (e: Event) => {
      const detail = (e as CustomEvent<{ token?: string }>).detail;
      if (detail?.token) setToken(detail.token);
    };
    window.addEventListener("dba:authenticated", onAuth as EventListener);
    window.addEventListener(UNAUTHORIZED_EVENT, () => { /* consumers handle redirect */ });
    return () => { uninstall(); window.removeEventListener("dba:authenticated", onAuth as EventListener); };
  }, []);
  return null;
}
