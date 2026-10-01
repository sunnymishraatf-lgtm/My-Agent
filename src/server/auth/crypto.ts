/**
 * Password hashing (scrypt) + Google ID token verification.
 * No new dependencies — node:crypto only.
 */
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const dk = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${dk.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const [algo, salt, dkHex] = hash.split("$");
    if (algo !== "scrypt" || !salt || !dkHex) return false;
    const dk = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(dkHex, "hex");
    return dk.length === expected.length && timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

export interface GoogleProfile {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Verify a Google ID token (from GIS on the client) and return the profile.
 * Uses Google's public certs; caches them for 1h. clientId must match the
 * server's GOOGLE_CLIENT_ID (prevents token substitution from other apps).
 */
let certCache: { certs: Record<string, string>; fetchedAt: number } | null = null;

async function googleCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() - certCache.fetchedAt < 3600_000) return certCache.certs;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error("could not fetch Google certs");
  const data = (await res.json()) as { keys: { kid: string; n: string; e: string }[] };
  const certs: Record<string, string> = {};
  for (const k of data.keys || []) certs[k.kid] = JSON.stringify(k);
  certCache = { certs, fetchedAt: Date.now() };
  return certs;
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleProfile> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error("bad token");
  const hB64: string = parts[0];
  const pB64: string = parts[1];
  const sigB64: string = parts[2];
  const header = JSON.parse(b64urlDecode(hB64).toString()) as { kid?: string; alg?: string };
  const payload = JSON.parse(b64urlDecode(pB64).toString()) as any;
  if (header.alg !== "RS256" || !header.kid) throw new Error("bad token alg");
  const certs = await googleCerts();
  const jwkJson = certs[header.kid];
  if (!jwkJson) throw new Error("unknown key");
  const { createVerify, createPublicKey } = await import("node:crypto");
  const key = createPublicKey({ key: JSON.parse(jwkJson), format: "jwk" });
  const v = createVerify("RSA-SHA256");
  v.update(`${hB64}.${pB64}`);
  if (!v.verify(key, b64urlDecode(sigB64))) throw new Error("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error("bad issuer");
  }
  if (payload.aud !== clientId) throw new Error("audience mismatch");
  if (typeof payload.exp !== "number" || payload.exp < now - 30) throw new Error("expired");
  if (!payload.sub) throw new Error("no sub");
  return { sub: String(payload.sub), email: payload.email, name: payload.name, picture: payload.picture };
}
