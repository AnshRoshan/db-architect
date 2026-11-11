import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  apiError,
  createSession,
  createWorkspaceForUser,
  currentUser,
  destroySession,
  hashPassword,
  requireUser,
  userOrganizations,
  verifyPassword,
} from "@/lib/auth";
import { audit } from "@/lib/server";
import { ensureSchema } from "@/lib/bootstrap";
import { ensureDemoWorkspace } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const user = await currentUser();
    if (!user) return NextResponse.json({ user: null });
    const memberships = await userOrganizations(user.id);
    return NextResponse.json({ user, memberships: memberships.map((m) => ({ ...m.organization, role: m.role })) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = await req.json();
    const action = String(body.action ?? "login");
    if (action === "logout") {
      await destroySession();
      return NextResponse.json({ ok: true });
    }
    if (action === "demo") {
      // Guaranteed sandbox entry: no credentials required.
      const demo = await ensureDemoWorkspace();
      const token = await createSession(demo.user.id);
      await audit(demo.projectId, demo.user.email, "auth.demo_session", "user", demo.user.id, {});
      return NextResponse.json({ user: demo.user, token, project: { id: demo.projectId }, demo: true });
    }
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    if (action === "signup") {
      const name = String(body.name ?? "").trim().slice(0, 200);
      if (name.length < 2) return NextResponse.json({ error: "Enter your name" }, { status: 400 });
      if (password.length < 10) return NextResponse.json({ error: "Password must be at least 10 characters" }, { status: 400 });
      const existing = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length) {
        // An account may already exist (e.g. invited by an admin). If the supplied
        // password matches, sign in instead of dead-ending with a 409.
        if (verifyPassword(password, existing[0].passwordHash)) {
          const token = await createSession(existing[0].id);
          return NextResponse.json({ user: { id: existing[0].id, email, name }, token });
        }
        return NextResponse.json({ error: "An account with this email already exists. Sign in with its password, or use a different email." }, { status: 409 });
      }
      const [created] = await db.insert(users).values({ email, name, passwordHash: hashPassword(password) }).returning({ id: users.id, email: users.email, name: users.name });
      const workspace = await createWorkspaceForUser(created, String(body.workspace ?? "").trim() || undefined);
      const token = await createSession(created.id);
      await audit(workspace.project.id, email, "auth.signup", "user", created.id, { workspace: workspace.org.name });
      return NextResponse.json({ user: created, token, project: workspace.project }, { status: 201 });
    }
    if (action === "login") {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!rows.length || !verifyPassword(password, rows[0].passwordHash)) {
        return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
      }
      const token = await createSession(rows[0].id);
      await audit(null, email, "auth.login", "user", rows[0].id, {});
      return NextResponse.json({ user: { id: rows[0].id, email: rows[0].email, name: rows[0].name }, token });
    }
    if (action === "password") {
      const user = await requireUser();
      const currentPassword = String(body.currentPassword ?? "");
      if (password.length < 10) return NextResponse.json({ error: "New password must be at least 10 characters" }, { status: 400 });
      const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (!rows.length || !verifyPassword(currentPassword, rows[0].passwordHash)) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
      await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, user.id));
      await audit(null, user.email, "auth.password_rotate", "user", user.id, {});
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown auth action" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
