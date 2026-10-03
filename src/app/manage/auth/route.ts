import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  manageCookieOptions,
  manageCookieName,
  supabaseConfiguration,
} from "../../../server/supabase-config";
import { isLocalFictional } from "../../../server/mode";

export async function POST(request: NextRequest) {
  const connection = supabaseConfiguration();
  if (!connection || isLocalFictional())
    return new Response("編集用接続はまだ設定されていません。", {
      status: 503,
    });
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return new Response("この操作は許可されていません。", { status: 403 });
  const response = NextResponse.redirect(
    new URL("/manage/login?error=1", request.url),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const client = createServerClient(connection.url, connection.key, {
    cookieOptions: { ...manageCookieOptions, name: manageCookieName },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, cacheHeaders) {
        for (const { name, value, options } of values) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, {
            ...options,
            ...manageCookieOptions,
          });
        }
        for (const [name, value] of Object.entries(cacheHeaders))
          response.headers.set(name, value);
      },
    },
  });
  const clearCookies = () => {
    const names = new Set(
      [...request.cookies.getAll(), ...response.cookies.getAll()]
        .filter(
          (cookie) =>
            cookie.name === manageCookieName ||
            cookie.name.startsWith(`${manageCookieName}.`),
        )
        .map((cookie) => cookie.name),
    );
    for (const name of names)
      response.cookies.set(name, "", { ...manageCookieOptions, maxAge: 0 });
  };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10000)
      return new Response("入力が長すぎます。", { status: 413 });
    if (
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      return new Response("ログイン画面から操作してください。", {
        status: 415,
      });
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 10000)
      return new Response("入力が長すぎます。", { status: 413 });
    const form = new URLSearchParams(body);
    if (form.get("action") === "logout") {
      try {
        await client.auth.signOut({ scope: "local" });
      } catch {
        /* Local logout still clears this browser. */
      }
      clearCookies();
      response.headers.set(
        "Location",
        new URL("/manage/login", request.url).href,
      );
      return response;
    }
    if (form.get("action") === "google") {
      const signedIn = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: new URL("/manage/auth/callback", request.url).href,
          skipBrowserRedirect: true,
        },
      });
      if (signedIn.error || !signedIn.data.url) return response;
      const destination = new URL(signedIn.data.url);
      if (
        destination.origin !== connection.url ||
        destination.pathname !== "/auth/v1/authorize"
      )
        return response;
      response.headers.set("Location", destination.href);
      return response;
    }
    if (form.get("action") !== "login")
      return new Response("この操作は許可されていません。", { status: 400 });
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || email.length > 254 || !password || password.length > 1024)
      return response;
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) return response;
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || data.user.is_anonymous) {
      await client.auth.signOut({ scope: "local" });
      clearCookies();
      return response;
    }
    const member = await client.rpc("noemap_editor_identity");
    if (
      member.error ||
      !member.data ||
      member.data.user_id !== data.user.id ||
      typeof member.data.label !== "string" ||
      !member.data.label.trim()
    ) {
      await client.auth.signOut({ scope: "local" });
      clearCookies();
      return response;
    }
    response.headers.set("Location", new URL("/manage", request.url).href);
    return response;
  } catch {
    // Fail closed, clearing any session written during an incomplete sign-in.
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      /* Auth unavailable. */
    }
    clearCookies();
    return response;
  }
}
