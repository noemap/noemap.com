import { spawn } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { seedLocalKnowledge } from "../tests/fixtures/local-knowledge.mjs";
import { seedExplorationKnowledge } from "../tests/fixtures/exploration-knowledge.mjs";

const dir = resolve(".local", `app-${randomUUID()}`);
await mkdir(dir, { recursive: true });
const port = await new Promise((done, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => done(port));
  });
});
const password = randomBytes(24).toString("hex");
const db = new EmbeddedPostgres({
  databaseDir: resolve(dir, "data"),
  port,
  user: "postgres",
  password,
  authMethod: "scram-sha-256",
  persistent: true,
  createPostgresUser: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
let started = false;
let web;
try {
  await db.initialise();
  await db.start();
  started = true;
  const admin = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "postgres",
  });
  await admin.connect();
  await admin.query("CREATE DATABASE noemap_local");
  await admin.end();
  const owner = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "noemap_local",
  });
  await owner.connect();
  for (const name of [
    "001-foundation.sql",
    "002-editorial-foundation.sql",
    "003-editorial-api.sql",
    "004-editor-search.sql",
    "005-exploration.sql",
    "006-chronology.sql",
  ])
    await owner.query(await readFile(`db/migrations/${name}`, "utf8"));
  const accounts = {};
  const loginLines = [
    "NOEMAP ローカル確認用のログイン情報",
    "このファイルはGitHubへ保存しません。",
    "",
  ];
  for (const [id, label, roles] of [
    ["owner", "運営者", ["editor", "reviewer", "publisher"]],
    ["writer", "執筆者", ["editor"]],
    ["checker", "確認者", ["reviewer"]],
  ]) {
    const user = `local_${id}`,
      dbPassword = randomBytes(24).toString("hex"),
      loginPassword = randomBytes(15).toString("base64url"),
      salt = randomBytes(16).toString("hex");
    await owner.query(
      `CREATE ROLE ${user} LOGIN PASSWORD '${dbPassword}' IN ROLE ${roles.map((r) => `nm_${r}`).join(",")}`,
    );
    await owner.query(
      "INSERT INTO publication.principals(db_role,can_edit,can_review,can_publish) VALUES($1,$2,$3,$4)",
      [
        user,
        roles.includes("editor"),
        roles.includes("reviewer"),
        roles.includes("publisher"),
      ],
    );
    accounts[id] = {
      label,
      roles,
      user,
      dbPassword,
      salt,
      passwordHash: scryptSync(loginPassword, salt, 64).toString("hex"),
    };
    loginLines.push(`${label}：${id}`, `パスワード：${loginPassword}`, "");
  }
  const readerPassword = randomBytes(24).toString("hex");
  await owner.query(
    `CREATE ROLE local_reader LOGIN PASSWORD '${readerPassword}' IN ROLE nm_reader`,
  );
  await owner.end();
  const seed = new pg.Client({
    host: "127.0.0.1",
    port,
    user: accounts.owner.user,
    password: accounts.owner.dbPassword,
    database: "noemap_local",
  });
  await seed.connect();
  const fixture = await seedExplorationKnowledge(
    seed,
    await seedLocalKnowledge(seed),
  );
  await seed.end();
  const config = {
    mode: "local-fictional",
    host: "127.0.0.1",
    port,
    database: "noemap_local",
    origin: "http://127.0.0.1:4320",
    sessionSecret: randomBytes(32).toString("hex"),
    reader: { user: "local_reader", password: readerPassword },
    accounts,
    fixture,
  };
  const runtimePath = resolve(".local", "app-runtime.json");
  await writeFile(runtimePath, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  await writeFile(
    resolve(".local", "editor-login.txt"),
    loginLines.join("\n"),
    { mode: 0o600 },
  );
  console.log("NOEMAP local app: http://127.0.0.1:4320");
  console.log("ログイン情報: .local/editor-login.txt");
  web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "4320",
    ],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, NOEMAP_RUNTIME_FILE: runtimePath },
    },
  );
  const stop = () => web?.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const code = await new Promise((done, reject) => {
    web.once("error", reject);
    web.once("exit", done);
  });
  if (code) process.exitCode = Number(code);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  web?.kill();
} finally {
  if (started) await db.stop();
}
if (process.exitCode) process.exit(process.exitCode);
