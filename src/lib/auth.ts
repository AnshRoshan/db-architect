import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, gt, inArray } from "drizzle-orm";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { organizationMembers, organizations, projects, schemaScans, sessions, users } from "@/db/schema";
import { ensureSchema } from "@/lib/bootstrap";

export const SESSION_COOKIE = "dba_session";
const SESSION_DAYS = 7;
export type Role = "owner" | "admin" | "architect" | "developer" | "viewer";
export type Access = "read" | "write" | "review" | "admin";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a session and returns the raw token.
 *
 * The token is delivered two ways on purpose:
 *  1. an HTTP-only cookie (normal same-site browsing), and
 *  2. the response body, stored client-side and sent as `Authorization: Bearer`.
 *
 * Preview deployments are frequently rendered inside an iframe, where browsers
 * drop SameSite=Lax cookies on subresource requests — which made sign-in look
 * successful while every following API call returned 401. The bearer fallback
 * keeps sessions working there without weakening anything: the token is still
 * 256-bit random, stored only as a SHA-256 hash server-side, and expires.
 */
export async function createSession(userId: string): Promise<string> {
  await ensureSchema();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ userId, tokenHash: tokenHash(token), expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // None survives cross-site iframe embedding (HTTPS only)
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = (await sessionToken()) ?? jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token))).catch(() => undefined);
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function sessionToken(): Promise<string | null> {
  const h = await headers();
  const custom = h.get("x-dba-session")?.trim();
  if (custom) return custom;
  const auth = h.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
  }
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export interface Identity {
  id: string;
  email: string;
  name: string;
}

export async function currentUser(): Promise<Identity | null> {
  await ensureSchema();
  const token = await sessionToken();
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
    .catch(() => []);
  return rows[0] ?? null;
}

export async function requireUser(): Promise<Identity> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in to continue");
  return user;
}

const rank: Record<Role, number> = { viewer: 1, developer: 2, architect: 3, admin: 4, owner: 5 };
const needed: Record<Access, number> = { read: 1, write: 2, review: 3, admin: 4 };

export interface ProjectAccess {
  project: typeof projects.$inferSelect;
  role: Role;
  organization: typeof organizations.$inferSelect;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, label: string) {
  if (!UUID_RE.test(value)) throw new HttpError(400, `${label} is missing or invalid`);
}

export async function requireProject(projectId: string, access: Access = "read"): Promise<ProjectAccess> {
  const user = await requireUser();
  assertUuid(projectId, "Project id");
  const rows = await db
    .select({ project: projects, role: organizationMembers.role, organization: organizations })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId))
    .innerJoin(organizationMembers, and(eq(organizationMembers.orgId, projects.orgId), eq(organizationMembers.userId, user.id)))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!rows.length) throw new HttpError(404, "Project not found or not accessible");
  const role = rows[0].role as Role;
  if ((rank[role] ?? 0) < needed[access]) throw new HttpError(403, `${access} permission requires a higher workspace role`);
  return rows[0] as ProjectAccess;
}

export async function requireScan(scanId: string, access: Access = "read") {
  const user = await requireUser();
  assertUuid(scanId, "Scan id");
  const rows = await db
    .select({ projectId: projects.id })
    .from(projects)
    .innerJoin(organizationMembers, and(eq(organizationMembers.orgId, projects.orgId), eq(organizationMembers.userId, user.id)))
    .innerJoin(schemaScans, eq(schemaScans.projectId, projects.id))
    .where(eq(schemaScans.id, scanId))
    .limit(1);
  if (!rows.length) throw new HttpError(404, "Scan not found or not accessible");
  return requireProject(rows[0].projectId, access);
}

export async function userOrganizations(userId: string) {
  return db
    .select({ organization: organizations, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, userId));
}

export async function accessibleProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(organizationMembers, and(eq(organizationMembers.orgId, projects.orgId), eq(organizationMembers.userId, userId)));
  return rows.map((r) => r.id);
}

export async function assertProjectSetAccess(userId: string, ids: string[]) {
  if (!ids.length) return;
  const owned = await accessibleProjectIds(userId);
  if (ids.some((id) => !owned.includes(id))) throw new HttpError(403, "One or more projects are outside your workspaces");
}

export function apiError(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  let message = error instanceof Error ? error.message : String(error);
  if (/Failed query:/i.test(message)) {
    // Never leak generated SQL or internal parameter values to clients.
    if (/invalid input syntax for type uuid/i.test(message)) message = "A required identifier was missing or invalid";
    else if (/relation .* does not exist/i.test(message)) message = "The application schema is still initializing. Retry in a moment.";
    else if (/duplicate key/i.test(message)) message = "That record already exists";
    else message = "The database rejected this operation";
  }
  message = message
    .replace(/\/\/[^@/\s]+:[^@/\s]+@/g, "//***:***@")
    .replace(/\b(password|passwd|pwd)\s*[=:]\s*[^\s,;&]+/gi, "$1=***")
    .replace(/\b(scrypt|mongodb\+srv):\/\/\S+/gi, "$1://***")
    .trim();
  if (!message) message = "Unexpected server error";
  console.error(`[db-architect] ${status} ${message}`);
  return NextResponse.json({ error: message.slice(0, 600) }, { status });
}

export async function createWorkspaceForUser(user: Identity, workspaceName?: string) {
  const slugBase = (workspaceName ?? `${user.name}'s workspace`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "workspace";
  const [org] = await db.insert(organizations).values({ name: workspaceName ?? `${user.name}'s workspace`, slug: `${slugBase}-${randomBytes(3).toString("hex")}` }).returning();
  await db.insert(organizationMembers).values({ orgId: org.id, userId: user.id, role: "owner" });
  const [project] = await db.insert(projects).values({ orgId: org.id, name: "Commerce platform", description: "Your first database architecture project", defaultEngine: "postgres", createdBy: user.id }).returning();
  return { org, project };
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(inArray(sessions.tokenHash, [])).catch(() => undefined);
}
