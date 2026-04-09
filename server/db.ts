import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql2 from "mysql2";
import { users, type User, type InsertUser } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  const sslParam = u.searchParams.get("ssl");
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: sslParam ? JSON.parse(sslParam) : { rejectUnauthorized: true },
    connectTimeout: 30000,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  };
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const config = parseDatabaseUrl(process.env.DATABASE_URL);
      // drizzle/mysql2 expects the callback-based pool (mysql2, not mysql2/promise)
      const pool = mysql2.createPool(config);
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

export async function createUser(data: InsertUser): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(users).values(data);
  return (result[0] as { insertId: number }).insertId;
}

// Legacy stub: no-op in custom email/password auth mode
export async function upsertUser(_user?: unknown): Promise<void> {}

// Legacy stub: no-op in custom email/password auth mode
export async function getUserByOpenId(_openId?: string): Promise<User | undefined> {
  return undefined;
}
