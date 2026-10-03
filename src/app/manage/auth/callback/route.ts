import { NextResponse, type NextRequest } from "next/server";
import { manageClient } from "../../../../server/supabase";
import { cookies } from "next/headers";
import {
  manageCookieName,
  manageCookieOptions,
} from "../../../../server/supabase-config";

export async function GET(request: NextRequest) {
  const destination = new URL("/manage/login?error=1", request.url);
  const client = await manageClient();
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (
      client &&
      code &&
      code.length <= 4096 &&
      !request.nextUrl.searchParams.has("error")
    ) {
      const exchange = await client.auth.exchangeCodeForSession(code);
      if (!exchange.error) {
        const { data, error } = await client.auth.getUser();
        if (!error && data.user && !data.user.is_anonymous) {
          const member = await client.rpc("noemap_editor_identity");
          if (
            !member.error &&
            member.data?.user_id === data.user.id &&
            typeof member.data.label === "string" &&
            member.data.label.trim()
          ) {
            destination.pathname = "/manage";
            destination.search = "";
          }
        }
      }
    }
  } catch {
    // Missing/expired PKCE or unavailable Auth never admits an editor.
  }
  if (client && destination.pathname !== "/manage") {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      /* Retry sign-in on a later request. */
    }
    const store = await cookies();
    for (const cookie of store.getAll()) {
      if (
        cookie.name === manageCookieName ||
        cookie.name.startsWith(`${manageCookieName}.`) ||
        cookie.name.startsWith(`${manageCookieName}-`)
      )
        store.set(cookie.name, "", { ...manageCookieOptions, maxAge: 0 });
    }
  }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
