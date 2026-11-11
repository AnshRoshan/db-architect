import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, organizationMembers, users } from "@/db/schema";
import { apiError, hashPassword, requireProject, requireUser, Role, userOrganizations } from "@/lib/auth";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";
const ROLES: Role[] = ["owner", "admin", "architect", "developer", "viewer"];

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ organizations: await userOrganizations(user.id) });
    const access = await requireProject(projectId, "read");
    const members = await db.select({ id: organizationMembers.id, role: organizationMembers.role, createdAt: organizationMembers.createdAt, userId: users.id, email: users.email, name: users.name }).from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId)).where(eq(organizationMembers.orgId, access.project.orgId));
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.projectId, projectId)).orderBy(auditLogs.createdAt).limit(100);
    return NextResponse.json({ organization: access.organization, role: access.role, members, audit: logs.reverse() });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser();
    const body = await req.json();
    const access = await requireProject(String(body.projectId ?? ""), "admin");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "viewer") as Role;
    if (!/^\S+@\S+\.\S+$/.test(email) || !ROLES.includes(role)) return NextResponse.json({ error: "Valid email and role required" }, { status: 400 });
    if (role === "owner" && access.role !== "owner") return NextResponse.json({ error: "Only an owner can assign owner" }, { status: 403 });
    let invited = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    let temporaryPassword: string | null = null;
    if (!invited) {
      temporaryPassword = randomBytes(9).toString("base64url");
      [invited] = await db.insert(users).values({ email, name: String(body.name ?? email.split("@")[0]).slice(0, 200), passwordHash: hashPassword(temporaryPassword) }).returning();
    }
    const existing = await db.select().from(organizationMembers).where(and(eq(organizationMembers.orgId, access.project.orgId), eq(organizationMembers.userId, invited.id))).limit(1);
    if (existing.length) {
      await db.update(organizationMembers).set({ role }).where(eq(organizationMembers.id, existing[0].id));
    } else {
      await db.insert(organizationMembers).values({ orgId: access.project.orgId, userId: invited.id, role });
    }
    await audit(access.project.id, actor.email, existing.length ? "member.role_change" : "member.invite", "user", invited.id, { email, role });
    // Returned once to the inviting admin; never stored in plaintext.
    return NextResponse.json({ ok: true, member: { email, role }, temporaryPassword }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "admin");
    const memberId = searchParams.get("memberId") ?? "";
    const rows = await db.select().from(organizationMembers).where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.orgId, access.project.orgId))).limit(1);
    if (!rows.length) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (rows[0].role === "owner") return NextResponse.json({ error: "Transfer ownership before removing the owner" }, { status: 400 });
    await db.delete(organizationMembers).where(eq(organizationMembers.id, memberId));
    await audit(access.project.id, actor.email, "member.remove", "member", memberId, {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
