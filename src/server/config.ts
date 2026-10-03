import "server-only";
import { readFile } from "node:fs/promises";
import type { Role } from "../domain/types";
export interface Account {
  label: string;
  roles: Role[];
  user: string;
  dbPassword: string;
  salt: string;
  passwordHash: string;
}
export interface LocalConfig {
  mode: "local-fictional";
  host: string;
  port: number;
  database: string;
  origin: string;
  sessionSecret: string;
  reader: { user: string; password: string };
  accounts: Record<string, Account>;
}
export async function configuration(): Promise<LocalConfig> {
  const file = process.env.NOEMAP_RUNTIME_FILE;
  if (!file) throw new Error("NOEMAP_NOT_CONFIGURED");
  const result = JSON.parse(await readFile(file, "utf8")) as LocalConfig;
  if (
    result.mode !== "local-fictional" ||
    result.host !== "127.0.0.1" ||
    result.origin !== "http://127.0.0.1:4320"
  )
    throw new Error("NOEMAP_NOT_CONFIGURED");
  return result;
}
