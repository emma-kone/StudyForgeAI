import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const COOKIE_NAME = "sfs_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours
const SECRET_FILE = path.join(process.cwd(), "db", ".auth-secret");

// ── Secret de signature (persisté localement, surchargeable par AUTH_SECRET) ──
function getSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

// ── Hachage de mot de passe : scrypt (N=16384) + sel aléatoire ───────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ── Jeton de session signé (HMAC-SHA256) ─────────────────────────────────────
function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function createToken(userId: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const payload = `${userId}.${expStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now()) return null;
  return userId;
}

// ── Cookie de session (httpOnly, sameSite lax) ───────────────────────────────
export async function setSessionCookie(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, createToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // le proxy du bac à sable gère le TLS
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// ── Utilisateur courant (contrôle serveur systématique) ──────────────────────
export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const userId = verifyToken(token);
  if (!userId) return null;
  try {
    return await db.user.findUnique({ where: { id: userId } });
  } catch {
    return null;
  }
}

/** Garde d'API : renvoie l'utilisateur ou lève une réponse 401. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export class AuthError extends Error {
  status = 401;
  constructor() {
    super("Authentification requise");
  }
}

// ── Compte personnel par défaut (créé au premier lancement) ──────────────────
export const DEFAULT_ACCOUNT = {
  email: "etudiante@studyforge.local",
  password: "studyforge2025",
  name: "Étudiante",
};

export async function ensureDefaultAccount() {
  const count = await db.user.count();
  if (count === 0) {
    await db.user.create({
      data: {
        email: DEFAULT_ACCOUNT.email,
        passwordHash: hashPassword(DEFAULT_ACCOUNT.password),
        name: DEFAULT_ACCOUNT.name,
        settings: { create: {} },
      },
    });
    // Matières d'exemple vides pour aider à démarrer
    const user = await db.user.findFirst({ where: { email: DEFAULT_ACCOUNT.email } });
    if (user) {
      await db.subject.createMany({
        data: [
          { userId: user.id, name: "Bases de données & SQL", color: "#8b5cf6" },
          { userId: user.id, name: "Algorithmique & programmation", color: "#059669" },
          { userId: user.id, name: "Systèmes & réseaux", color: "#d97706" },
        ],
      });
    }
  }
}

// ── Limitation de débit simple (en mémoire) pour les routes sensibles ────────
const rateBuckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset < now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}
