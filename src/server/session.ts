import "server-only";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { configuration } from "./config";
import { isLocalFictional } from "./mode";
import type { Role } from "../domain/types";
export const cookieName = "noemap_editor";
const attempts = new Map<string, { count: number; until: number }>();
function mac(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
export async function login(id: string, password: string) {
  if (!isLocalFictional()) return null;
  const cfg = await configuration();
  const now = Date.now();
  const prior = attempts.get(id);
  if (prior && prior.until > now && prior.count >= 5) return null;
  if (attempts.size > 50) attempts.clear();
  const account = Object.hasOwn(cfg.accounts, id)
    ? cfg.accounts[id]
    : undefined;
  const expected = Buffer.from(account?.passwordHash ?? "0".repeat(128), "hex");
  const actual = scryptSync(password, account?.salt ?? "not-a-user", 64);
  if (!account || !timingSafeEqual(actual, expected)) {
    attempts.set(id, {
      count: (prior && prior.until > now ? prior.count : 0) + 1,
      until: now + 60000,
    });
    return null;
  }
  attempts.delete(id);
  const body = Buffer.from(
    JSON.stringify({
      id,
      expires: now + 3600000,
      nonce: randomBytes(12).toString("hex"),
    }),
  ).toString("base64url");
  return `${body}.${mac(body, cfg.sessionSecret)}`;
}
export async function session() {
  if (!isLocalFictional()) return null;
  const cfg = await configuration();
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || token.length > 512) return null;
  const [body, signature, ...extra] = token.split(".");
  if (
    !body ||
    !signature ||
    extra.length ||
    !/^[-_A-Za-z0-9]+$/.test(signature)
  )
    return null;
  const a = Buffer.from(signature, "base64url"),
    b = Buffer.from(mac(body, cfg.sessionSecret), "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const account = cfg.accounts[data.id];
    if (
      !account ||
      typeof data.expires !== "number" ||
      data.expires < Date.now()
    )
      return null;
    return {
      id: data.id as string,
      label: account.label,
      roles: account.roles,
    };
  } catch {
    return null;
  }
}
export function permitted(actor: { roles: Role[] }, role: Role) {
  return actor.roles.includes(role);
}
export async function sameOrigin(request: Request) {
  if (!isLocalFictional()) return false;
  const cfg = await configuration();
  return (
    request.headers.get("host") === new URL(cfg.origin).host &&
    request.headers.get("origin") === cfg.origin
  );
}
