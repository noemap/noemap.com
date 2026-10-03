import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  manageCookieOptions,
  manageCookieName,
  supabaseConfiguration,
} from "./server/supabase-config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const connection = supabaseConfiguration();
  if (connection && !process.env.NOEMAP_RUNTIME_FILE) {
    const client = createServerClient(connection.url, connection.key, {
      cookieOptions: { ...manageCookieOptions, name: manageCookieName },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, headers) {
          for (const { name, value } of values)
            request.cookies.set(name, value);
          const next = NextResponse.next({ request });
          for (const cookie of response.cookies.getAll())
            next.cookies.set(cookie);
          for (const { name, value, options } of values)
            next.cookies.set(name, value, {
              ...options,
              ...manageCookieOptions,
            });
          for (const [name, value] of Object.entries(headers))
            next.headers.set(name, value);
          response = next;
        },
      },
    });
    try {
      // Refresh only; each protected page/action additionally calls getUser and
      // queries the current editor membership in the database.
      await client.auth.getClaims();
    } catch {
      // Authentication checks in pages/actions fail closed if Auth is unavailable.
    }
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = { matcher: ["/manage/:path*"] };
