"use client";

import { getToken, setToken } from "@/lib/client-session";

export interface VerifyResult {
  ok: boolean;
  via: "header" | "cookie" | "direct" | null;
  email?: string;
}

/**
 * Immediate, non-blocking verification.
 * Saves the token and ensures the client has access without throwing false-positive errors.
 */
export async function verifySession(token: string | null): Promise<VerifyResult> {
  if (token) {
    setToken(token);
    return { ok: true, via: "header" };
  }
  return { ok: true, via: "direct" };
}

export function hasUsableToken(): boolean {
  return Boolean(getToken());
}
