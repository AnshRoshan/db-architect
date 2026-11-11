import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers, organizations, projects } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select({ project: projects, role: organizationMembers.role, organizationName: organizations.name, organizationId: organizations.id })
      .from(projects)
      .innerJoin(organizations, eq(organizations.id, projects.orgId))
      .innerJoin(organizationMembers, and(eq(organizationMembers.orgId, projects.orgId), eq(organizationMembers.userId, user.id)))
      .orderBy(desc(projects.createdAt))
      .limit(100);
    return NextResponse.json({ projects: rows.map((r) => ({ ...r.project, role: r.role, organizationName: r.organizationName, organizationId: r.organizationId })) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const orgs = await db.select({ orgId: organizationMembers.orgId, role: organizationMembers.role }).from(organizationMembers).where(eq(organizationMembers.userId, user.id));
    const adminOrg = orgs.find((o) => o.role === "owner" || o.role === "admin");
    if (!adminOrg) return NextResponse.json({ error: "Only workspace owners and admins can create projects" }, { status: 403 });
    const name = String(body.name ?? "").trim();
    if (name.length < 2) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    const [project] = await db.insert(projects).values({
      orgId: adminOrg.orgId,
      name: name.slice(0, 200),
      description: String(body.description ?? "").slice(0, 2000),
      defaultEngine: body.engine === "mongodb" ? "mongodb" : "postgres",
      createdBy: user.id,
      updatedAt: new Date(),
    }).returning();
    await audit(project.id, user.email, "project.create", "project", project.id, { name: project.name });
    return NextResponse.json({ project: { ...project, role: adminOrg.role } }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const access = await requireProject(String(body.projectId ?? ""), "admin");
    const name = String(body.name ?? access.project.name).trim();
    const [project] = await db.update(projects).set({ name: name.slice(0, 200), description: String(body.description ?? access.project.description ?? "").slice(0, 2000), updatedAt: new Date() }).where(eq(projects.id, access.project.id)).returning();
    await audit(project.id, user.email, "project.update", "project", project.id, {});
    return NextResponse.json({ project });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "admin");
    if (access.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can delete projects" }, { status: 403 });
    await audit(access.project.id, user.email, "project.delete", "project", access.project.id, { name: access.project.name });
    await db.delete(projects).where(and(eq(projects.id, access.project.id), inArray(projects.orgId, [access.project.orgId])));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
