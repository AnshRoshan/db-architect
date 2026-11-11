// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import Providers from "../src/components/providers";
import ArchitectureView from "../src/components/views/architecture-view";
import DashboardView from "../src/components/views/dashboard-view";
import ExplorerView from "../src/components/views/explorer-view";
import ConnectPanel from "../src/components/connect-panel";
import { ArchitectureShowcase, type ShowcaseData } from "../src/components/landing-sections";
import type { ModelT } from "../src/components/views/types";
import { analyzeArchitecture } from "../src/lib/architecture";
import { parseMongoJson, parseSqlDdl } from "../src/lib/dsl";
import { parseRedisDump } from "../src/lib/redis-model";
import { FIXTURE_COMMERCE_MONGO_JSON, FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "../src/lib/fixtures-polyglot";

const core = () => parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres").model;
const cache = () => parseRedisDump(FIXTURE_REDIS_JSON, "commerce_cache").model;
const report = () => analyzeArchitecture([
  { id: "core", name: "commerce-core", engine: "postgres", role: "primary", model: core(), scanId: "scan-core", designScore: 61, findingCount: 14, versions: 1 },
  { id: "content", name: "commerce-content", engine: "mongodb", role: "service", model: parseMongoJson(FIXTURE_COMMERCE_MONGO_JSON, "commerce_content").model, scanId: "scan-content", versions: 1 },
  { id: "cache", name: "commerce-cache", engine: "redis", role: "cache", model: cache(), scanId: "scan-cache", versions: 1 },
], [{ id: "f1", fromStoreId: "core", toStoreId: "cache", kind: "cache_aside" }]);

function mockFetch(routes: Record<string, unknown>) {
  const calls: { url: string; body?: unknown }[] = [];
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof window.fetch;
  return calls;
}

beforeEach(() => {
  cleanup();
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) });
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ""; thresholds = []; };
});

describe("Architecture view", () => {
  const props = { projectId: "p1", canWrite: true, canAdmin: true, onOpenScan: vi.fn(), onConnect: vi.fn(), onChanged: vi.fn(), notify: vi.fn() };

  it("renders the topology, the schema map of the selected store and the findings", async () => {
    const r = report();
    mockFetch({ "/api/v1/architecture": { ...r, flows: [{ id: "f1", fromStoreId: "core", toStoreId: "cache", kind: "cache_aside", description: null }], scans: [] } });
    render(<Providers><ArchitectureView {...props} /></Providers>);
    expect(await screen.findByText("System topology")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Datastore topology" })).toBeTruthy();
    for (const name of ["commerce-core", "commerce-content", "commerce-cache"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getByText("Cache-aside")).toBeTruthy(); // declared flow label on the edge
    expect(await screen.findByRole("img", { name: /Schema dependency map for commerce-core/ })).toBeTruthy();
    expect(screen.getByText(/Circular schema dependency/)).toBeTruthy();
    expect(screen.getByText("Entity stored in two systems with no declared sync")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Cross-store links/ }));
    expect(screen.getAllByText("same entity").length).toBe(1);
    expect(screen.getAllByText("cached copy").length).toBeGreaterThan(1);
    // selecting the Redis store swaps the inspector
    fireEvent.click(screen.getAllByRole("button", { name: /commerce-cache/ })[0]);
    await waitFor(() => expect(screen.queryByRole("img", { name: /Schema dependency map/ })).toBeNull());
    expect(screen.getByText("dbs")).toBeTruthy(); // Redis namespaces are logical databases
  });

  it("changing a role posts the action and re-renders from the response", async () => {
    const r = report();
    const calls = mockFetch({ "/api/v1/architecture": { ...r, flows: [], scans: [] } });
    render(<Providers><ArchitectureView {...props} /></Providers>);
    const select = (await screen.findByLabelText(/Role in the system/)) as HTMLSelectElement;
    expect(select.value).toBe("primary");
    fireEvent.change(select, { target: { value: "service" } });
    await waitFor(() => expect(calls.some((c) => (c.body as { action?: string })?.action === "update_store")).toBe(true));
    expect(calls.find((c) => (c.body as { action?: string })?.action === "update_store")?.body).toMatchObject({ projectId: "p1", storeId: "core", role: "service" });
  });

  it("offers the sample system when the project has no datastores", async () => {
    mockFetch({ "/api/v1/architecture": { ...analyzeArchitecture([], []), flows: [], scans: [] } });
    render(<Providers><ArchitectureView {...props} /></Providers>);
    expect(await screen.findByText("Map every database your system runs on")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Load a sample polyglot system/ })).toBeTruthy();
  });
});

describe("Explorer with many schemas and with Redis", () => {
  it("groups entities by schema", () => {
    render(<Providers><ExplorerView model={core() as unknown as ModelT} findings={[]} onOpenDiagram={() => {}} onOpenAnalysis={() => {}} /></Providers>);
    for (const ns of ["auth", "catalog", "sales", "billing"]) expect(screen.getAllByText(ns).length).toBeGreaterThan(0);
    expect(screen.getByText("schemas")).toBeTruthy();
    expect(screen.getByRole("option", { name: "All schemas" })).toBeTruthy();
  });
  it("shows data type and TTL coverage for a keyspace", async () => {
    render(<Providers><ExplorerView model={cache() as unknown as ModelT} findings={[]} onOpenDiagram={() => {}} onOpenAnalysis={() => {}} /></Providers>);
    expect(screen.getAllByText("session:{session_id}").length).toBeGreaterThan(0);
    expect(screen.getByText(/TTL ~/)).toBeTruthy();
    fireEvent.click(screen.getByText("otp:{otp_id}"));
    expect(await screen.findByText("no TTL")).toBeTruthy(); // after the detail panel transition
  });
});

describe("Dashboard and Connect", () => {
  it("dashboard leads with the system of datastores", () => {
    mockFetch({});
    const go = vi.fn();
    render(<Providers><DashboardView dash={{ stats: { stores: 2, engines: 2, flows: 1, findings: 3, designScore: 82, bySeverity: { medium: 3 } }, stores: [{ id: "a", name: "commerce-core", engine: "postgres", role: "primary", scanId: "s1", versions: 2, entities: 20, namespaces: 8, findings: 14, designScore: 61 }, { id: "b", name: "commerce-cache", engine: "redis", role: "cache", scanId: null, versions: 0, entities: 0, namespaces: 0, findings: 0, designScore: null }] }} scans={[{ id: "s1", engine: "postgres", source: "upload", status: "completed", progress: 100, label: "PostgreSQL core", storeName: "commerce-core", version: 2 }]} findings={[]} model={core() as unknown as ModelT} go={go} projectId="p1" reload={() => {}} setMsg={() => {}} canWrite /></Providers>);
    expect(screen.getByText("Your system")).toBeTruthy();
    expect(screen.getByText("System of record")).toBeTruthy();
    expect(screen.getByText("No schema captured yet — add one")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open architecture/ }));
    expect(go).toHaveBeenCalledWith("Architecture");
  });

  it("connect panel discovers schemas and turns picks into a selection", async () => {
    const calls = mockFetch({ "/api/v1/connections/schemas": { engine: "postgres", kind: "schema", namespaces: [{ name: "auth", tables: 3, views: 0 }, { name: "billing", tables: 3, views: 1 }, { name: "public", tables: 2, views: 0 }] }, "/api/v1/connections": { connections: [] } });
    render(<Providers><ConnectPanel projectId="p1" stores={[{ id: "st1", name: "commerce-core", engine: "postgres", role: "primary" }]} onImported={() => {}} setMsg={() => {}} /></Providers>);
    fireEvent.click(screen.getByRole("tab", { name: /Redis/ }));
    expect(screen.getByText("Logical databases to sample")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /PostgreSQL/ }));
    expect(screen.getByText("Schemas to scan")).toBeTruthy();
    const selection = screen.getByLabelText("Selection") as HTMLInputElement;
    expect(selection.value).toBe("*");
    fireEvent.click(screen.getByRole("button", { name: /Discover schemas/ }));
    const billing = await screen.findByRole("button", { name: /billing/ });
    expect(billing.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(billing);
    expect(selection.value).toBe("auth,public");
    fireEvent.click(billing);
    expect(selection.value).toBe("*");
    expect(calls.find((c) => c.url.includes("/connections/schemas"))?.body).toMatchObject({ engine: "postgres", schemaSelection: "*" });
    expect(screen.getByRole("option", { name: /commerce-core · PostgreSQL/ })).toBeTruthy();
  });
});

describe("landing architecture showcase", () => {
  it("renders both levels from analyzer output", () => {
    const r = report();
    const c = r.stores.find((s) => s.id === "core")!;
    const data: ShowcaseData = {
      schemas: { namespaces: c.namespaces.map((n) => ({ name: n.name, entities: n.entities })), edges: c.edges, cycles: c.cycles, tables: 20, crossFks: 9 },
      schemaFindings: [{ ruleId: "PG-SCHEMA-001", severity: "medium", title: "Circular dependency between schemas", object: "auth ⇄ billing" }],
      stores: r.stores.map((s) => ({ id: s.id, name: s.name, engine: s.engine, role: s.role, entities: s.entities, namespaces: s.namespaces.length })),
      pairs: [{ a: "content", b: "core", count: 4 }], flows: [{ from: "core", to: "cache", label: "cache-aside" }],
      systemFindings: r.findings.slice(0, 2).map((f) => ({ ruleId: f.ruleId, severity: f.severity, title: f.title, object: f.object })), score: r.score, links: r.links.length,
    };
    render(<Providers><ArchitectureShowcase data={data} /></Providers>);
    expect(screen.getByRole("img", { name: /Schema dependency map/ })).toBeTruthy();
    expect(screen.getByText("Circular dependency between schemas")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Many databases, one system/ }));
    return waitFor(() => expect(screen.getByRole("img", { name: /Topology of the sample system/ })).toBeTruthy());
  });
});
