import "server-only";
import pg from "pg";
import { configuration } from "./config";
const pools = new Map<string, pg.Pool>();
async function pool(accountId?: string) {
  const cfg = await configuration();
  const account = accountId ? cfg.accounts[accountId] : undefined;
  if (accountId && !account) throw new Error("NOEMAP_UNAUTHORIZED");
  const user = account?.user ?? cfg.reader.user;
  const key = `${cfg.port}:${user}`;
  let result = pools.get(key);
  if (!result) {
    result = new pg.Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user,
      password: account?.dbPassword ?? cfg.reader.password,
      max: 3,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 3000,
      statement_timeout: 6000,
      lock_timeout: 3000,
    });
    pools.set(key, result);
  }
  return result;
}
export async function value<T>(
  sql: string,
  args: unknown[] = [],
  accountId?: string,
): Promise<T> {
  const response = await (await pool(accountId)).query(sql, args);
  return Object.values(response.rows[0] ?? {})[0] as T;
}
export async function transaction<T>(
  accountId: string,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await (await pool(accountId)).connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
