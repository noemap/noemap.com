import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isLocalFictional } from "./mode";
import {
  manageCookieName,
  manageCookieOptions,
  supabaseConfiguration,
} from "./supabase-config";

export async function manageClient() {
  const config = supabaseConfiguration();
  if (!config || isLocalFictional()) return null;
  const store = await cookies();
  // A client is created per request; no session state is shared between users.
  return createServerClient(config.url, config.key, {
    cookieOptions: { ...manageCookieOptions, name: manageCookieName },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          for (const { name, value, options } of values)
            store.set(name, value, { ...options, ...manageCookieOptions });
        } catch {
          // Server Components cannot set cookies. /manage Proxy refreshes them.
        }
      },
    },
  });
}
