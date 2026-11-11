// Real-browser end-to-end auth test (Playwright + headless Chromium).
// Usage: APP=http://127.0.0.1:3200 node e2e/auth.e2e.mjs
import { chromium } from "playwright";
import http from "node:http";

const APP = process.env.APP ?? "http://127.0.0.1:3200";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

async function inWorkspace(frame, timeout = 15000) {
  // The workspace shell renders the "Overview" nav section and a sign-out control.
  try { await frame.getByRole("button", { name: "Sign out" }).waitFor({ timeout }); return true; } catch { return false; }
}
async function onSignIn(frame, timeout = 15000) {
  try { await frame.getByText("Sign in securely").waitFor({ timeout }); return true; } catch { return false; }
}

const browser = await chromium.launch();
const errors = [];

// ── Scenario A: top-level signup → reload → logout → login ──
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`A pageerror: ${e.message}`));
  const email = `e2e${Date.now()}@example.com`;
  await page.goto(`${APP}/app`);
  ok("A1 anonymous visitor sees sign-in", await onSignIn(page));
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByPlaceholder("Ada Lovelace").fill("E2E Tester");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("At least 10 characters").fill("correct-horse-battery");
  await page.getByRole("button", { name: /Create account & workspace/ }).click();
  ok("A2 signup lands in workspace", await inWorkspace(page));
  await page.waitForTimeout(1500);
  ok("A3 still in workspace after data loads (no bounce)", await inWorkspace(page, 3000));
  await page.reload();
  ok("A4 reload keeps the session", await inWorkspace(page));
  await page.getByRole("button", { name: "Sign out" }).click();
  ok("A5 sign out returns to sign-in", await onSignIn(page));
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("Your password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /Sign in securely/ }).click();
  ok("A6 login with the same account works", await inWorkspace(page));
  await page.waitForTimeout(1500);
  ok("A7 no bounce after login", await inWorkspace(page, 3000));
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("Your password").fill("wrong-password-123");
  await page.getByRole("button", { name: /Sign in securely/ }).click();
  let wrong = false; try { await page.getByRole("alert").filter({ hasText: /incorrect/i }).waitFor({ timeout: 8000 }); wrong = true; } catch {}
  ok("A8 wrong password is rejected with a message", wrong);
  await ctx.close();
}

// ── Scenario B: landing page demo button ──
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`B pageerror: ${e.message}`));
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: /Try the demo/ }).first().click();
  await page.waitForURL(/\/app/, { timeout: 15000 }).catch(() => {});
  ok("B1 landing demo button opens the workspace", await inWorkspace(page));
  await ctx.close();
}

// ── Scenario C: cross-site iframe with third-party cookies blocked ──
{
  const host = http.createServer((_, res) => { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><iframe id="f" src="${APP.replace("127.0.0.1", "localhost")}/app" style="width:1300px;height:900px;border:0"></iframe>`); });
  await new Promise((r) => host.listen(3301, "127.0.0.1", r));
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 920 } });
  // Simulate a browser that blocks third-party cookies: strip cookies on the framed app's requests.
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    if (req.url().includes("localhost")) { const h = { ...req.headers() }; delete h.cookie; return route.continue({ headers: h }); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`C pageerror: ${e.message}`));
  await page.goto("http://127.0.0.1:3301/");
  const frame = page.frameLocator("#f");
  const f = { getByText: (t) => frame.getByText(t), getByRole: (r, o) => frame.getByRole(r, o), getByPlaceholder: (p) => frame.getByPlaceholder(p) };
  ok("C1 iframe shows sign-in", await onSignIn(f));
  await f.getByRole("button", { name: /Explore the demo workspace/ }).click();
  ok("C2 demo works inside a cookie-blocked iframe", await inWorkspace(f));
  await page.waitForTimeout(1500);
  ok("C3 no bounce inside the iframe", await inWorkspace(f, 3000));
  await ctx.close();
  host.close();
}

await browser.close();
if (errors.length) console.log("\nBrowser errors:\n" + errors.join("\n"));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
