// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import Providers from "../src/components/providers";
import ThemeToggle from "../src/components/theme-toggle";
import { CountUp, Reveal, RevealGroup, RevealItem, Typewriter } from "../src/components/motion";
import HeroScene from "../src/components/hero-scene";
import { AdvisorBars, TransformShowcase } from "../src/components/landing-sections";
import { UNAUTHORIZED_EVENT, installFetchInterceptor, setToken, getToken, clearToken } from "../src/lib/client-session";

// jsdom lacks these; framer-motion / next-themes probe them.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; };
  clearToken();
  window.localStorage.clear();
  document.documentElement.className = "";
});

describe("theme system", () => {
  it("cycles light → dark → system, toggles the .dark class and persists", async () => {
    render(<Providers><ThemeToggle compact /></Providers>);
    const btn = await screen.findByRole("button", { name: /Theme:/ });
    expect(btn).toBeTruthy();
    // default is system (matchMedia → light)
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await act(async () => { fireEvent.click(btn); });               // system → light
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Theme:/ })); }); // light → dark
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("dark"));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Theme:/ })); }); // dark → system
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("system"));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  });
  it("segmented toggle exposes a radiogroup with three options", async () => {
    render(<Providers><ThemeToggle /></Providers>);
    const group = await screen.findByRole("radiogroup", { name: /Color theme/ });
    expect(group.querySelectorAll('[role="radio"]').length).toBe(3);
    await act(async () => { fireEvent.click(screen.getByTitle("dark")); });
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  });
});

describe("motion primitives", () => {
  it("Reveal / RevealGroup render children", () => {
    render(<Providers><Reveal><p>hello</p></Reveal><RevealGroup as="ul"><RevealItem as="li">one</RevealItem><RevealItem as="li">two</RevealItem></RevealGroup></Providers>);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(2);
  });
  it("CountUp renders a number and Typewriter renders text", async () => {
    render(<Providers><CountUp to={21} /><Typewriter phrases={["abc"]} speed={1} /></Providers>);
    await waitFor(() => expect(document.body.textContent).toMatch(/\d/));
    await waitFor(() => expect(document.body.textContent).toContain("a"), { timeout: 2000 });
  });
});

describe("landing scenes", () => {
  it("HeroScene renders the diagram, tabs and side panel", () => {
    render(<Providers><HeroScene /></Providers>);
    expect(screen.getByRole("img", { name: /entity-relationship/ })).toBeTruthy();
    for (const t of ["Diagram", "Analysis", "Transform"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText(/Introspecting/)).toBeTruthy();
  });
  it("TransformShowcase and AdvisorBars render", () => {
    render(<Providers><TransformShowcase /><AdvisorBars ranked={[{ id: "pg", label: "PostgreSQL", score: 86 }]} /></Providers>);
    expect(screen.getByText(/MongoDB document/)).toBeTruthy();
    expect(screen.getByText("PostgreSQL")).toBeTruthy();
    expect(screen.getByText("86")).toBeTruthy();
  });
});

// ── session transport ────────────────────────────────────────────────

describe("session transport (cookie-less environments)", () => {
  // Unmount anything left from earlier cases so its fetch interceptor is removed
  // before we install our own controllable transport.
  beforeEach(() => cleanup());
  it("stores, attaches and clears the bearer token on API calls only", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const realFetch = window.fetch;
    window.fetch = (async (input: RequestInfo | URL) => { calls.push({ url: String(input), auth: new Headers().get("authorization") }); return new Response("{}", { status: 200 }); }) as typeof window.fetch;
    const uninstall = installFetchInterceptor();
    setToken("tok-123");
    expect(getToken()).toBe("tok-123");
    await window.fetch("/api/v1/projects");
    expect(calls[0].url).toContain("/api/");
    uninstall();
    window.fetch = realFetch;
    clearToken();
    expect(getToken()).toBeNull();
  });
  it("401s from non-identity endpoints never destroy the session", async () => {
    const realFetch = window.fetch;
    window.fetch = (async () => new Response("{}", { status: 401 })) as typeof window.fetch;
    const uninstall = installFetchInterceptor();
    setToken("valid-token");
    let fired = 0;
    const onUnauth = () => { fired += 1; };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauth);
    await window.fetch("/api/v1/projects"); // role-gated/failed call
    expect(fired).toBe(0);                 // session survives
    expect(getToken()).toBe("valid-token");
    await window.fetch("/api/v1/auth");    // identity probe says 401
    expect(fired).toBe(1);                 // now the app is notified, once
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauth);
    uninstall();
    window.fetch = realFetch;
  });
});
