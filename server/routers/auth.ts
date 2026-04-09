import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { getUserByEmail, getUserById, createUser } from "../db";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  users,
  syncFlashcards,
  syncCompletedTexts,
  syncWordMistakes,
  syncPreferences,
  syncSegmentationOverrides,
  syncVocabIgnored,
  decks,
  deckCards,
  storyDecks,
  storyDeckWords,
} from "../../drizzle/schema";

const COOKIE_NAME = "mashang_session";
const SALT_ROUNDS = 12;

function getSecret() {
  const secret = process.env.JWT_SECRET || "fallback-dev-secret-change-in-prod";
  return new TextEncoder().encode(secret);
}

function getCookieOptions(req: { protocol?: string; headers?: Record<string, string | string[] | undefined> }) {
  const isSecure = req.protocol === "https" || (req.headers?.["x-forwarded-proto"] as string) === "https";
  return {
    httpOnly: true,
    secure: isSecure,
    // Use "lax" (not "none") — frontend and backend share the same origin on Render,
    // so same-site cookies work. "none" requires Partitioned in modern browsers and
    // is blocked by Safari/Brave/Firefox strict mode.
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

async function signToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifySessionCookie(cookieHeader: string | undefined): Promise<number | null> {
  if (!cookieHeader) return null;
  // Parse cookie header
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k.trim()] = v.join("=");
  }
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = parseInt(payload.sub as string, 10);
    return isNaN(userId) ? null : userId;
  } catch {
    return null;
  }
}

export const authRouter = router({
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        email: z.string().email(),
        password: z.string().min(8).max(128),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getUserByEmail(input.email);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
      }
      const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
      const userId = await createUser({
        email: input.email,
        passwordHash,
        name: input.name,
        lastSignedIn: new Date(),
      });
      const token = await signToken(userId);
      ctx.res.cookie(COOKIE_NAME, token, getCookieOptions(ctx.req));
      return { success: true, userId };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await getUserByEmail(input.email);
      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      }
      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      }
      const token = await signToken(user.id);
      ctx.res.cookie(COOKIE_NAME, token, getCookieOptions(ctx.req));
      return { success: true, user: { id: user.id, email: user.email, name: user.name } };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.res.clearCookie(COOKIE_NAME, { path: "/", maxAge: -1 });
    return { success: true };
  }),

  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    // Delete all user data in dependency order (child rows before parent)
    await db.delete(storyDeckWords).where(eq(storyDeckWords.userId, userId));
    await db.delete(storyDecks).where(eq(storyDecks.userId, userId));
    await db.delete(deckCards).where(eq(deckCards.userId, userId));
    await db.delete(decks).where(eq(decks.userId, userId));
    await db.delete(syncSegmentationOverrides).where(eq(syncSegmentationOverrides.userId, userId));
    await db.delete(syncVocabIgnored).where(eq(syncVocabIgnored.userId, userId));
    await db.delete(syncWordMistakes).where(eq(syncWordMistakes.userId, userId));
    await db.delete(syncCompletedTexts).where(eq(syncCompletedTexts.userId, userId));
    await db.delete(syncFlashcards).where(eq(syncFlashcards.userId, userId));
    await db.delete(syncPreferences).where(eq(syncPreferences.userId, userId));
    await db.delete(users).where(eq(users.id, userId));

    // Clear the session cookie
    ctx.res.clearCookie(COOKIE_NAME, { path: "/", maxAge: -1 });
    return { success: true };
  }),

  me: publicProcedure.query(async ({ ctx }) => {
    const cookieHeader = ctx.req.headers?.cookie as string | undefined;
    const userId = await verifySessionCookie(cookieHeader);
    if (!userId) return null;
    const user = await getUserById(userId);
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }),
});
