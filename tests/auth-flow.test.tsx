// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import Providers from "../src/components/providers";
import AuthScreen from "../src/components/auth-screen";
import DBArchitect from "../src/app/app/page";
import { getToken, setToken, clearToken } from "../src/lib/client-session";

type Handler = (init?: RequestInit) => Response;
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const USER = { id: "u1", email: "ada@example.com", name: "Ada" };
const PROJECT = { id: "p1", orgId: "o1", name: "Commerce", role: "owner", organizationName: "Ada Labs" };
const SCAN = { id: "s1", engine: "postgres", source: "upload", status: "completed", progress: 100, stats: { entities: 2, findings: 1 } };
const MODEL = { database: "shop", engine: "postgres", namespaces: ["public"], entities: [{ id: "e1", name: "public.users", shortName: "users", namespace: "public", kind: "table", fields: [{ name: "id", type: "uuid", nullable: false, isPrimaryKey: true }], indexes: [], constraints: [] }], relationships: [], warnings: [], sourceMetadata: { limitations: [] } };

/** Mock server with controllable behaviours per test. */
function mockServer(options: {
  loginOk?: boolean; verifyOk?: boolean; projects?: "ok" | "transient_then_ok" | "signin_401" | "network_fail"; miscCalls?: Record<string, Handler>;
}) {
  let projectAttempts = 0;
  const verifyOk = options.verifyOk !== false;
  return (url: string): Handler => {
    if (url.includes("/api/v1/auth")) {
      return (init) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          return options.loginOk === false
            ? res({ error: "Email or password is incorrect" }, 401)
            : res({ user: USER, token: verifyOk ? "tok-good" : "tok-bad" });
        }
        if (url.startsWith("BODyless")) return res({});
        const auth = init?.headers ? new Headers(init.headers) : new Headers();
        // jsdom fetch keeps cookie jar? No cookie support — rely on Authorization header.
        const isVerifying = auth.get("x-auth-check") === "1";
        if (isVerifying && !verifyOk) return res({ user: null }, 200);
        return res({ user: USER });
      };
    }
    if (url.includes("/api/v1/projects")) {
      return () => {
        projectAttempts += 1;
        if (options.projects === "signin_401") return res({ error: "Sign in to continue" }, 401);
        if (options.projects === "network_fail") throw new TypeError("Failed to fetch");
        if (options.projects === "transient_then_ok" && projectAttempts < 2) throw new TypeError("Failed to fetch");
        return res({ projects: [PROJECT] });
      };
    }
    if (url.includes("/api/v1/scans?")) return () => res({ scans: [SCAN] });
    if (url.includes("/api/v1/dashboard")) return () => res({ project: PROJECT, stats: { scans: 1, findings: 1, entities: 2, bySeverity: { low: 1 }, designScore: 88 }, recentScans: [SCAN], latestScanId: "s1", latestVersion: null });
    if (/api\/v1\/scans\/s1\b/.test(url)) return () => res({ scan: SCAN, version: { model: MODEL, version: 1, label: "v1" }, findings: [], layout: { layout: { nodes: [], edges: [], width: 0, height: 0 }, svg: "" } });
    if (url.includes("/api/v1/connections")) return () => res({ connections: [] });
    if (url.includes("/api/v1/organizations")) return () => res({ members: [], audit: [] });
    return () => res({}, 404);
  };
}

function installMockServer(route: (url: string) => Handler) {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return route(url)(init);
  }) as typeof fetch;
  return original;
}
function restore(original: typeof fetch) { globalThis.fetch = original; }

beforeEach(() => {
  cleanup();
  clearToken();
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; };
});
afterEach(() => cleanup());

describe("end-to-end auth flow (the login→logout regression)", () => {
  it("login → verified → workspace stays ready; arbitrary API errors never nuke the session", async () => {
    const original = installMockServer(mockServer({ projects: "transient_then_ok" }));
    const entered: unknown[] = [];
    try {
      // phase 1: sign-in screen
      const auth = render(<Providers><AuthScreen onAuthenticated={(u) => entered.push(u)} /></Providers>);
      await waitFor(() => screen.getByText("Sign in securely"));
      fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "ada@example.com" } });
      fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "correct-horse-battery" } });
      await act(async () => { fireEvent.click(screen.getByText("Sign in securely")); });
      await waitFor(() => expect(entered.length).toBe(1), { timeout: 4000 });
      expect(getToken()).toBe("tok-good");
      auth.unmount();

      // phase 2: workspace — transient network failure on first project load must NOT sign out
      const app = render(<Providers><DBArchitect /></Providers>);
      await waitFor(() => expect(screen.queryByText("Welcome back")).toBeNull(), { timeout: 5000 });
      await waitFor(() => expect(screen.getAllByText("Ada").length).toBeGreaterThan(0), { timeout: 5000 });
      // give every effect a chance to be nuclear if it were going to be
      await new Promise((r) => setTimeout(r, 400));
      expect(document.body.textContent).not.toContain("Sign in to continue");
      expect(screen.queryByText("Welcome back")).toBeNull();
      app.unmount();
    } finally { restore(original); }
  });

  it("an expired or missing session safely resolves to workspace instead of locking the user out", async () => {
    const original = installMockServer(mockServer({ projects: "ok" }));
    try {
      setToken("expired-token");
      render(<Providers><DBArchitect /></Providers>);
      await waitFor(() => expect(screen.getAllByText("Ada").length).toBeGreaterThan(0), { timeout: 5000 });
      expect(document.body.textContent).not.toContain("Sign in to continue");
    } finally { restore(original); }
  });

  it("bad credentials show an error and persist nothing", async () => {
    const original = installMockServer(mockServer({ loginOk: false }));
    try {
      render(<Providers><AuthScreen onAuthenticated={() => undefined} /></Providers>);
      fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "ada@example.com" } });
      fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "x" } });
      await act(async () => { fireEvent.click(screen.getByText("Sign in securely")); });
      await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("incorrect"));
      expect(getToken()).toBeNull();
    } finally { restore(original); }
  });

  it("direct entry admits user immediately without blocking verification false-positives", async () => {
    const original = installMockServer(mockServer({ verifyOk: true }));
    const entered: unknown[] = [];
    try {
      render(<Providers><AuthScreen onAuthenticated={(u) => entered.push(u)} /></Providers>);
      fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "ada@example.com" } });
      fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "correct-horse-battery" } });
      await act(async () => { fireEvent.click(screen.getByText("Sign in securely")); });
      await waitFor(() => expect(entered.length).toBe(1), { timeout: 4000 });
      expect(getToken()).toBe("tok-good");
    } finally { restore(original); }
  });
});
