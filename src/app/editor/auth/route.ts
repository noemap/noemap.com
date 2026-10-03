import { NextResponse } from "next/server";
import { login, sameOrigin, cookieName } from "../../../server/session";
import { configuration } from "../../../server/config";
export async function POST(request: Request) {
  if (!(await sameOrigin(request)))
    return new Response("この操作は許可されていません。", { status: 403 });
  const origin = (await configuration()).origin;
  const data = await request.formData();
  if (data.get("action") === "logout") {
    const response = NextResponse.redirect(
      new URL("/editor/login", origin),
      303,
    );
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/editor",
      maxAge: 0,
    });
    return response;
  }
  const id = String(data.get("account") ?? ""),
    password = String(data.get("password") ?? "");
  const token =
    id.length <= 30 && password.length <= 200
      ? await login(id, password)
      : null;
  const response = NextResponse.redirect(
    new URL(token ? "/editor" : "/editor/login?error=1", origin),
    303,
  );
  if (token)
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/editor",
      maxAge: 3600,
      secure: new URL(request.url).protocol === "https:",
    });
  return response;
}
