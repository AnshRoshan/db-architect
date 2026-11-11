// Screenshot every workspace view in light and dark mode for visual QA.
import { chromium } from "playwright";
const APP = process.env.APP ?? "http://127.0.0.1:3200";
const VIEWS = (process.env.VIEWS ?? "Dashboard,Explorer,Diagram,Analysis,Transform,Advisor,Reports,AI Assistant,History").split(",");
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const b = await chromium.launch();
for (const theme of THEMES) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme === "dark" ? "dark" : "light" });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${APP}/app`);
  await p.getByRole("button", { name: /Explore the demo workspace/ }).click();
  await p.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(1500);
  for (const v of VIEWS) {
    await p.locator("nav[aria-label=Main]").getByRole("button", { name: new RegExp(`^${v}`) }).first().click();
    await p.waitForTimeout(v === "Diagram" ? 1800 : 1100);
    if (v === "AI Assistant") { await p.getByRole("button", { name: /architectural & bottleneck audit/i }).first().click().catch(() => {}); await p.waitForTimeout(1500); }
    if (v === "Analysis") { await p.locator("article button[aria-expanded]").first().click().catch(() => {}); await p.waitForTimeout(500); }
    await p.screenshot({ path: `/tmp/shots/${theme}-${v.replace(/\W+/g, "_")}.png` });
  }
  if (errs.length) console.log(theme, "page errors:", errs);
  await ctx.close();
}
await b.close();
console.log("done");
