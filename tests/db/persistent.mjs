import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import net from "node:net";
import { execFileSync } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { createProvisionalRelease } from "../../src/domain/provisional.ts";
import { projectPublicDocument } from "../../src/domain/public-projection.ts";

// Disposable loopback cluster only. These stub Auth records/roles are test
// fixtures; no Supabase project, real user, session or credential is accessed.
const directory = resolve(".local", `persistent-db-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const port = await new Promise((done, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const selected = server.address().port;
    server.close(() => done(selected));
  });
});
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: resolve(directory, "data"),
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
const original = JSON.parse(
  await readFile("src/data/public-release.json", "utf8"),
);
const editorId = "11111111-1111-4111-8111-111111111111";
const unregisteredId = "22222222-2222-4222-8222-222222222222";
const seedId = randomUUID();
let started = false;
let postgresVersion;
let clients = [];
const results = [];
let admin, anon, editor, editor2, unregistered;
async function connect(role, userId, databaseName = "noemap_persistent_test") {
  const client = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: databaseName,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
    lock_timeout: 10000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  if (role) {
    assert.ok(["anon", "authenticated"].includes(role));
    await client.query(`SET ROLE ${role}`);
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
      userId ?? "",
    ]);
    assert.equal(
      (await client.query("SELECT current_user")).rows[0].current_user,
      role,
    );
  }
  return client;
}
async function scalar(client, sql, args = []) {
  return Object.values((await client.query(sql, args)).rows[0] ?? {})[0];
}
const sqlProjection = (document) =>
  scalar(admin, "SELECT noemap_private.project_document($1::jsonb)", [
    JSON.stringify(document),
  ]);
const readEditor = () => scalar(editor, "SELECT public.noemap_read_editor()");
const publicRow = async (client = anon) =>
  (
    await client.query(
      "SELECT generation,snapshot_id,document FROM public.noemap_public_release WHERE id",
    )
  ).rows[0];
const save = (client, generation, document, reason, operation = randomUUID()) =>
  scalar(client, "SELECT public.noemap_save_draft($1,$2::jsonb,$3,$4)", [
    generation,
    JSON.stringify(document),
    reason,
    operation,
  ]);
const publish = (
  generation,
  reason = "Local test publication",
  operation = randomUUID(),
) =>
  scalar(editor, "SELECT public.noemap_publish_draft($1,$2,$3)", [
    generation,
    reason,
    operation,
  ]);
async function denied(client, sql, args = []) {
  await assert.rejects(
    client.query(sql, args),
    (error) => error.code === "42501",
  );
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function same(actual, expected, message) {
  assert.equal(digest(actual), digest(expected), message);
}
function readerEquivalence(raw, projected, name) {
  const expected = createProvisionalRelease(raw);
  const actual = createProvisionalRelease(projected);
  same(actual.visibility(), expected.visibility(), `${name}: visibility`);
  const sortedCatalog = (api) =>
    api.catalog().sort((a, b) => a.id.localeCompare(b.id));
  same(sortedCatalog(actual), sortedCatalog(expected), `${name}: catalog`);
  same(actual.explorationHome(), expected.explorationHome(), `${name}: home`);
  same(actual.timelineNodes(), expected.timelineNodes(), `${name}: timeline`);
  for (const batch of raw.batches) {
    for (const node of batch.node_candidates) {
      same(
        actual.publicNode(node.id),
        expected.publicNode(node.id),
        `${name}: node ${node.id}`,
      );
      same(
        actual.nodePage(node.id),
        expected.nodePage(node.id),
        `${name}: node page ${node.id}`,
      );
      same(
        actual.neighbors(node.id),
        expected.neighbors(node.id),
        `${name}: neighbors ${node.id}`,
      );
      same(
        actual.evidence(`${node.id}-summary`),
        expected.evidence(`${node.id}-summary`),
        `${name}: summary proof ${node.id}`,
      );
    }
    for (const claim of batch.assertion_candidates)
      same(
        actual.evidence(claim.id),
        expected.evidence(claim.id),
        `${name}: claim proof ${claim.id}`,
      );
    for (const [index, relation] of batch.relationship_candidates.entries()) {
      const id = relation.id ?? `${batch.batch_id}:relation:${index}`;
      same(
        actual.evidence(id),
        expected.evidence(id),
        `${name}: relation proof ${id}`,
      );
    }
  }
  for (const date of raw.temporal_records)
    same(
      actual.evidence(date.id),
      expected.evidence(date.id),
      `${name}: date proof ${date.id}`,
    );
  for (const query of ["", "David Hume", "人格同一性", "省察"])
    for (const offset of [0, 20])
      same(
        actual.searchNodes(query, undefined, offset),
        expected.searchNodes(query, undefined, offset),
        `${name}: search ${query}/${offset}`,
      );
  same(
    actual.visibility(),
    createProvisionalRelease(projectPublicDocument(raw)).visibility(),
    `${name}: JS projector visibility`,
  );
}
async function test(name, work) {
  const start = Date.now();
  try {
    await work();
    results.push({ name, status: "passed", duration_ms: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      status: "failed",
      message: error.message,
      code: error.code,
      context: error.where,
      duration_ms: Date.now() - start,
    });
    console.log(`FAIL ${name}: ${error.message}`);
    if (error.where) console.log(error.where);
    process.exitCode = 1;
  }
}
async function waitBlocked(waiting, blocker) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (
      await scalar(admin, "SELECT $2::integer=ANY(pg_blocking_pids($1))", [
        waiting.processID,
        blocker.processID,
      ])
    )
      return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error(
    "Concurrent transaction did not acquire the expected row lock",
  );
}
async function freshImportDatabase(name) {
  assert.ok(
    ["noemap_initial_import_test", "noemap_backup_import_test"].includes(name),
  );
  await admin.query(`CREATE DATABASE ${name}`);
  const client = await connect(undefined, undefined, name);
  await client.query(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
  `);
  await client.query(
    await readFile(
      "supabase/migrations/20261003031858_noemap_persistent_snapshots.sql",
      "utf8",
    ),
  );
  return client;
}
function prepareImport(backupPath) {
  const args = [
    "scripts/prepare-persistent-database.mjs",
    ...(backupPath ? ["--backup", backupPath] : []),
  ];
  const result = JSON.parse(
    execFileSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.equal(result.status, "prepared_locally");
  assert.equal(result.cloud_changes, 0);
  assert.equal(result.account_grants, 0);
  return result;
}
try {
  await database.initialise();
  await database.start();
  started = true;
  const bootstrap = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "postgres",
  });
  await bootstrap.connect();
  try {
    await bootstrap.query("CREATE DATABASE noemap_persistent_test");
  } finally {
    await bootstrap.end();
  }
  admin = await connect();
  await admin.query(`
    CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
  `);
  await admin.query(
    await readFile(
      "supabase/migrations/20261003031858_noemap_persistent_snapshots.sql",
      "utf8",
    ),
  );
  await admin.query("INSERT INTO auth.users VALUES($1),($2)", [
    editorId,
    unregisteredId,
  ]);
  await admin.query(
    "INSERT INTO noemap_private.editors(user_id,label) VALUES($1,'Disposable test editor')",
    [editorId],
  );
  await admin.query("BEGIN");
  await admin.query("SELECT noemap_private.check_document($1::jsonb)", [
    JSON.stringify(original),
  ]);
  await admin.query(
    "INSERT INTO noemap_private.snapshots(id,document,actor_label,reason) VALUES($1,$2::jsonb,'Local test seed','Disposable fixture only')",
    [seedId, JSON.stringify(original)],
  );
  await admin.query(
    "INSERT INTO noemap_private.state(id,generation,current_snapshot_id) VALUES(true,0,$1)",
    [seedId],
  );
  await admin.query(
    "INSERT INTO public.noemap_public_release(id,generation,snapshot_id,document) VALUES(true,0,$1,noemap_private.project_document($2::jsonb))",
    [seedId, JSON.stringify(original)],
  );
  await admin.query("COMMIT");
  anon = await connect("anon");
  editor = await connect("authenticated", editorId);
  editor2 = await connect("authenticated", editorId);
  unregistered = await connect("authenticated", unregisteredId);
  postgresVersion = await scalar(admin, "SHOW server_version");
  console.log(
    `PostgreSQL ${postgresVersion}; disposable loopback cluster; Auth stubs only`,
  );

  await test("P01 migration and initial 36-node public projection match the visibility adapter", async () => {
    const row = await publicRow();
    assert.equal(Number(row.generation), 0);
    assert.equal(row.snapshot_id, seedId);
    assert.equal(createProvisionalRelease(row.document).catalog().length, 36);
    readerEquivalence(original, row.document, "initial");
    assert.equal(
      await scalar(
        admin,
        "SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('noemap_private','public') AND NOT c.relrowsecurity",
      ),
      0,
    );
  });
  await test("P02 anonymous users can read only the public row, with no history, helpers, writes or editor RPC", async () => {
    for (const table of ["editors", "snapshots", "state", "operations"])
      await denied(anon, `SELECT * FROM noemap_private.${table}`);
    await denied(anon, "SELECT noemap_private.project_document($1::jsonb)", [
      JSON.stringify(original),
    ]);
    await denied(anon, "SELECT public.noemap_editor_identity()");
    await denied(anon, "SELECT public.noemap_read_editor()");
    await denied(anon, "SELECT public.noemap_read_snapshot($1)", [seedId]);
    await denied(
      anon,
      "SELECT public.noemap_save_draft(0,$1::jsonb,'denied',$2)",
      [JSON.stringify(original), randomUUID()],
    );
    await denied(anon, "SELECT public.noemap_publish_draft(0,'denied',$1)", [
      randomUUID(),
    ]);
    await denied(anon, "SELECT public.noemap_restore_draft(0,$1,'denied',$2)", [
      seedId,
      randomUUID(),
    ]);
    for (const sql of [
      "UPDATE public.noemap_public_release SET generation=99 WHERE id",
      "DELETE FROM public.noemap_public_release WHERE id",
    ])
      await denied(anon, sql);
    await denied(
      anon,
      "INSERT INTO public.noemap_public_release(id,generation,snapshot_id,document) VALUES(true,99,$1,$2::jsonb)",
      [seedId, JSON.stringify(original)],
    );
  });
  await test("P03 authenticated membership is required freshly and direct raw writes remain forbidden", async () => {
    assert.equal(
      await scalar(unregistered, "SELECT public.noemap_editor_identity()"),
      null,
    );
    await denied(unregistered, "SELECT public.noemap_read_editor()");
    await denied(unregistered, "SELECT public.noemap_read_snapshot($1)", [
      seedId,
    ]);
    await denied(
      unregistered,
      "SELECT public.noemap_save_draft(0,$1::jsonb,'denied',$2)",
      [JSON.stringify(original), randomUUID()],
    );
    await denied(
      unregistered,
      "SELECT noemap_private.mutate('publish',0,null,null,'denied',$1)",
      [randomUUID()],
    );
    const identity = await scalar(
      editor,
      "SELECT public.noemap_editor_identity()",
    );
    assert.equal(identity.user_id, editorId);
    assert.equal((await readEditor()).current.id, seedId);
    for (const sql of [
      "SELECT * FROM noemap_private.snapshots",
      "UPDATE noemap_private.snapshots SET reason='tampered'",
      "DELETE FROM noemap_private.snapshots",
      "UPDATE public.noemap_public_release SET generation=99",
    ])
      await denied(editor, sql);
    await admin.query(
      "UPDATE noemap_private.editors SET enabled=false WHERE user_id=$1",
      [editorId],
    );
    try {
      assert.equal(
        await scalar(editor, "SELECT public.noemap_editor_identity()"),
        null,
      );
      await denied(editor, "SELECT public.noemap_read_editor()");
    } finally {
      await admin.query(
        "UPDATE noemap_private.editors SET enabled=true WHERE user_id=$1",
        [editorId],
      );
    }
  });
  await test("P04 private pending draft does not publish; stale generation and reused operations are rejected", async () => {
    const draft = structuredClone(original);
    draft.batches[0].node_candidates[0].summary_ja =
      "Local draft text awaiting a publication operation";
    const operation = randomUUID();
    const saved = await save(
      editor,
      0,
      draft,
      "Save local pending draft",
      operation,
    );
    assert.equal(saved.generation, 1);
    assert.equal(saved.current.id, seedId);
    assert.equal(saved.draft.document.human_review.status, "pending");
    assert.equal((await publicRow()).snapshot_id, seedId);
    assert.equal(
      JSON.stringify((await publicRow()).document).includes(
        "Local draft text awaiting",
      ),
      false,
    );
    const before = await scalar(
      admin,
      "SELECT count(*)::integer FROM noemap_private.snapshots",
    );
    assert.equal(
      (await save(editor, 0, draft, "Save local pending draft", operation))
        .generation,
      1,
    );
    assert.equal(
      await scalar(
        admin,
        "SELECT count(*)::integer FROM noemap_private.snapshots",
      ),
      before,
    );
    await assert.rejects(
      save(editor, 0, draft, "Other stale edit"),
      (e) => e.code === "40001",
    );
    await assert.rejects(
      save(editor, 0, draft, "Altered idempotent request", operation),
      (e) => e.code === "22023",
    );
    const fabricated = structuredClone(original);
    fabricated.human_review = {
      status: "approved",
      reviewer: "AI",
      approved_at: "2026-10-03",
    };
    await assert.rejects(
      save(editor, 1, fabricated, "Reject fabricated human approval"),
      (e) => e.code === "22023",
    );
    assert.equal((await readEditor()).generation, 1);
  });
  await test("P05 two connections serialize edits and reject the actual blocked stale writer", async () => {
    const current = await readEditor();
    await editor.query("BEGIN");
    let pending;
    try {
      const next = await save(
        editor,
        current.generation,
        original,
        "First concurrent edit",
      );
      pending = save(
        editor2,
        current.generation,
        original,
        "Second concurrent edit",
      ).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await waitBlocked(editor2, editor);
      await editor.query("COMMIT");
      const outcome = await pending;
      assert.equal(outcome.error?.code, "40001");
      assert.equal((await readEditor()).generation, next.generation);
    } catch (error) {
      await editor.query("ROLLBACK").catch(() => {});
      if (pending) await pending;
      throw error;
    }
  });
  await test("P06 SQL projection matches JS reading for every source and node/claim/relation/date withdrawal", async () => {
    const sources = original.batches.flatMap((batch) => batch.sources);
    const scenarios = sources.map((source) => ({
      name: `source ${source.id}`,
      sources: [source.id],
    }));
    const base = createProvisionalRelease(original);
    const firstBatch = original.batches[0];
    const relationId = `${firstBatch.batch_id}:relation:0`;
    scenarios.push(
      { name: "multiple sources", sources: [sources[0].id, sources.at(-1).id] },
      { name: "node", nodes: ["hume-p-hume"] },
      { name: "claim", assertions: ["hume-a-appendix-open"] },
      { name: "relationship", relationships: [relationId] },
      {
        name: "relationship UUID",
        relationships: [base.evidence(relationId).id],
      },
      {
        name: "relationship alias",
        relationships: ["hume-p-hume->hume-w-treatise"],
      },
      { name: "node UUID", nodes: [base.publicNode("hume-p-hume").id] },
      {
        name: "claim revision UUID",
        assertions: [base.evidence("hume-a-appendix-open").revision_id],
      },
      { name: "temporal", assertions: [original.temporal_records[0].id] },
      {
        name: "source revision UUID",
        sources: [base.evidence("hume-a-bundle").sources[0].source_revision_id],
      },
    );
    for (const scenario of scenarios) {
      const raw = structuredClone(original);
      for (const category of [
        "sources",
        "nodes",
        "assertions",
        "relationships",
      ])
        raw.withdrawn[category].push(...(scenario[category] ?? []));
      const projected = await sqlProjection(raw);
      assert.ok(
        Object.values(projected.withdrawn).every((list) => list.length === 0),
      );
      readerEquivalence(raw, projected, scenario.name);
    }
    console.log(
      `Projection equivalence: ${sources.length} individual sources and ${scenarios.length - sources.length} withdrawal variants`,
    );
  });
  await test("P07 public projection strips private nested text and preserves unknown data only in private history", async () => {
    const raw = structuredClone(original);
    const sentinel = "PRIVATE_TEST_SENTINEL_MUST_NEVER_APPEAR_IN_PUBLIC_JSON";
    raw.internal_note = sentinel;
    const batch = raw.batches[0];
    batch.review_requirements = [sentinel];
    batch.sources[0].original_work = { internal_note: sentinel };
    batch.sources[0].internal_note = sentinel;
    batch.node_candidates[1].evidence[0].internal_note = sentinel;
    batch.assertion_candidates[0].evidence[0].internal_note = sentinel;
    batch.relationship_candidates[0].internal_note = sentinel;
    raw.temporal_records[0].evidence[0].internal_note = sentinel;
    const projected = await sqlProjection(raw);
    assert.equal(JSON.stringify(projected).includes(sentinel), false);
    assert.equal(
      JSON.stringify(projectPublicDocument(raw)).includes(sentinel),
      false,
    );
    const saved = await save(
      editor,
      (await readEditor()).generation,
      raw,
      "Private metadata fixture",
    );
    assert.equal(JSON.stringify(saved.draft.document).includes(sentinel), true);
    await publish(saved.generation, "Publish sanitized fixture");
    assert.equal(
      JSON.stringify((await publicRow()).document).includes(sentinel),
      false,
    );
  });
  await test("P08 source withdrawal publication updates atomically and exposes no withdrawn raw records", async () => {
    const before = await readEditor();
    const raw = structuredClone(before.current.document);
    raw.withdrawn.sources.push("hume-s-appendix");
    const saved = await save(
      editor,
      before.generation,
      raw,
      "Withdraw Appendix fixture",
    );
    const publicBefore = await publicRow();
    const operation = randomUUID();
    const published = await publish(
      saved.generation,
      "Publish source withdrawal",
      operation,
    );
    const row = await publicRow();
    assert.equal(Number(row.generation), published.generation);
    assert.equal(row.snapshot_id, published.current.id);
    assert.notEqual(row.snapshot_id, publicBefore.snapshot_id);
    assert.ok(
      published.current.document.withdrawn.sources.includes("hume-s-appendix"),
    );
    const api = createProvisionalRelease(row.document);
    assert.equal(api.publicNode("hume-c-bundle"), null);
    assert.equal(api.evidence("hume-a-bundle"), null);
    assert.equal(
      row.document.batches
        .flatMap((b) => b.sources)
        .some((source) => source.id === "hume-s-appendix"),
      false,
    );
    assert.equal(
      row.document.batches
        .flatMap((b) => b.node_candidates)
        .some((node) => node.id === "hume-c-bundle"),
      false,
    );
    assert.equal(
      row.document.batches
        .flatMap((b) => b.assertion_candidates)
        .some((claim) => claim.id === "hume-a-bundle"),
      false,
    );
    readerEquivalence(
      published.current.document,
      row.document,
      "published withdrawal",
    );
    const repeated = await publish(
      saved.generation,
      "Publish source withdrawal",
      operation,
    );
    assert.equal(repeated.generation, published.generation);
    assert.equal((await publicRow()).snapshot_id, row.snapshot_id);
  });
  await test("P09 private restore preserves accumulated withdrawals and never republishes historical raw text", async () => {
    const before = await readEditor();
    const historical = await scalar(
      editor,
      "SELECT public.noemap_read_snapshot($1)",
      [seedId],
    );
    assert.equal(historical.document.withdrawn.sources.length, 0);
    const restored = await scalar(
      editor,
      "SELECT public.noemap_restore_draft($1,$2,'Restore local history',$3)",
      [before.generation, seedId, randomUUID()],
    );
    assert.ok(
      restored.draft.document.withdrawn.sources.includes("hume-s-appendix"),
    );
    assert.equal((await publicRow()).snapshot_id, before.current.id);
    const published = await publish(
      restored.generation,
      "Publish protected restore",
    );
    assert.ok(
      published.current.document.withdrawn.sources.includes("hume-s-appendix"),
    );
    assert.equal(
      createProvisionalRelease((await publicRow()).document).publicNode(
        "hume-c-bundle",
      ),
      null,
    );
    assert.equal(
      (await scalar(editor, "SELECT public.noemap_read_snapshot($1)", [seedId]))
        .document.withdrawn.sources.length,
      0,
    );
    assert.ok((await readEditor()).history.length >= 5);
  });
  await test("P10 public optional fields reject nested objects, and failed saves do not alter state", async () => {
    const before = await readEditor();
    const beforePublic = await publicRow();
    const malformed = [
      [
        "source title",
        (raw) => {
          raw.batches[0].sources[0].title = { private_note: "unsafe" };
        },
      ],
      [
        "node label",
        (raw) => {
          raw.batches[0].node_candidates[0].label = { private_note: "unsafe" };
        },
      ],
      [
        "source author",
        (raw) => {
          raw.batches[0].sources[0].author = { private_note: "unsafe" };
        },
      ],
      [
        "source edition",
        (raw) => {
          raw.batches[0].sources[0].edition = { private_note: "unsafe" };
        },
      ],
      [
        "source editors",
        (raw) => {
          raw.batches[0].sources[0].editors = [{ private_note: "unsafe" }];
        },
      ],
      [
        "node scope",
        (raw) => {
          raw.batches[0].node_candidates[0].scope_limit = {
            private_note: "unsafe",
          };
        },
      ],
      [
        "node aliases",
        (raw) => {
          raw.batches[0].node_candidates[0].aliases = [
            { private_note: "unsafe" },
          ];
        },
      ],
      [
        "claim nature",
        (raw) => {
          raw.batches[0].assertion_candidates[0].nature = {
            private_note: "unsafe",
          };
        },
      ],
      [
        "claim evidence locator",
        (raw) => {
          raw.batches[0].assertion_candidates[0].evidence[0].locator = {
            private_note: "unsafe",
          };
        },
      ],
      [
        "relation reason",
        (raw) => {
          raw.batches[0].relationship_candidates[0].reason = {
            private_note: "unsafe",
          };
        },
      ],
      [
        "full text metadata",
        (raw) => {
          raw.batches[0].sources[0].metadata = {
            full_text: "Forbidden full text fixture",
          };
        },
      ],
      [
        "raw HTML metadata",
        (raw) => {
          raw.metadata = { rawhtml: "<p>Forbidden raw HTML fixture</p>" };
        },
      ],
      [
        "fabricated human review",
        (raw) => {
          raw.human_review = {
            status: "approved",
            reviewer: "AI fixture",
            approved_at: "2026-10-03",
          };
        },
      ],
      [
        "global relationship identity collision",
        (raw) => {
          raw.batches[0].relationship_candidates[0].id =
            raw.batches[1].node_candidates[0].id;
        },
      ],
    ];
    for (const [name, mutate] of malformed) {
      const raw = structuredClone(original);
      mutate(raw);
      await assert.rejects(
        save(editor, before.generation, raw, `Reject malformed ${name}`),
        (error) => error.code === "22023",
      );
    }
    same(
      await readEditor(),
      before,
      "Rejected malformed drafts leave private state unchanged",
    );
    same(
      await publicRow(),
      beforePublic,
      "Rejected malformed drafts leave public state unchanged",
    );
  });
  await test("P11 revision withdrawals remain effective after save and restore assign new release IDs", async () => {
    const raw = structuredClone(original);
    const base = createProvisionalRelease(raw);
    const sourceEvidence = base.evidence("locke-claim-first-publication");
    assert.ok(
      sourceEvidence?.sources.length,
      "Locke bibliographic fixture has evidence",
    );
    const sourceId = sourceEvidence.sources[0].source_revision_id;
    const originalSourceId = raw.batches
      .flatMap((batch) => batch.sources)
      .find((source) => {
        const test = structuredClone(raw);
        test.withdrawn.sources = [sourceId];
        return !createProvisionalRelease(test)
          .visibility()
          .sources.includes(source.id);
      }).id;
    const nodeId = "hume-p-hume";
    const claimId = "hume-a-appendix-open";
    const relationId = `${raw.batches[0].batch_id}:relation:0`;
    const temporalId = raw.temporal_records[0].id;
    raw.withdrawn.sources = [sourceId];
    raw.withdrawn.nodes = [base.publicNode(nodeId).revision_id];
    raw.withdrawn.assertions = [
      base.evidence(claimId).revision_id,
      base.evidence(temporalId).revision_id,
    ];
    raw.withdrawn.relationships = [base.evidence(relationId).revision_id];
    const expectedCanonical = {
      sources: [originalSourceId],
      nodes: [nodeId],
      assertions: [claimId, temporalId],
      relationships: [relationId],
    };
    const saved = await save(
      editor,
      (await readEditor()).generation,
      raw,
      "Revision withdrawal fixture",
    );
    assert.notEqual(saved.draft.document.release_id, raw.release_id);
    for (const [category, ids] of Object.entries(expectedCanonical))
      for (const id of ids)
        assert.ok(
          saved.draft.document.withdrawn[category].includes(id),
          `${category} contains stable withdrawal ${id}`,
        );
    const published = await publish(
      saved.generation,
      "Publish revision withdrawal fixture",
    );
    readerEquivalence(
      published.current.document,
      (await publicRow()).document,
      "new release ID withdrawal",
    );
    const restored = await scalar(
      editor,
      "SELECT public.noemap_restore_draft($1,$2,'Restore after revision withdrawal',$3)",
      [published.generation, seedId, randomUUID()],
    );
    assert.notEqual(
      restored.draft.document.release_id,
      published.current.document.release_id,
    );
    for (const [category, ids] of Object.entries(expectedCanonical))
      for (const id of ids)
        assert.ok(
          restored.draft.document.withdrawn[category].includes(id),
          `Restore preserves ${category}/${id}`,
        );
    await publish(restored.generation, "Publish restored revision protection");
    const visible = createProvisionalRelease(
      (await publicRow()).document,
    ).visibility();
    assert.equal(visible.sources.includes(originalSourceId), false);
    assert.equal(visible.nodes.includes(nodeId), false);
    assert.equal(visible.assertions.includes(claimId), false);
    assert.equal(visible.relationships.includes(relationId), false);
    assert.equal(visible.temporals.includes(temporalId), false);
  });
  await test("P12 committed public head, private history and withdrawal protection survive database restart", async () => {
    const beforePublic = await publicRow();
    const beforeEditor = await readEditor();
    await Promise.all(clients.map((client) => client.end().catch(() => {})));
    clients = [];
    await database.stop();
    started = false;
    await database.start();
    started = true;
    admin = await connect();
    anon = await connect("anon");
    editor = await connect("authenticated", editorId);
    same(await publicRow(), beforePublic, "Public state survives restart");
    same(await readEditor(), beforeEditor, "Private history survives restart");
    assert.equal(
      createProvisionalRelease((await publicRow()).document).publicNode(
        "hume-c-bundle",
      ),
      null,
    );
    await denied(anon, "SELECT public.noemap_read_snapshot($1)", [seedId]);
  });
  await test("P13 implicit arrow aliases and explicit relation identities agree before and after SQL normalization", async () => {
    for (const explicit of [false, true]) {
      const raw = structuredClone(original);
      const first = raw.batches[0].relationship_candidates[0];
      if (explicit) first.id = "hume-test-explicit-relation";
      const id = first.id ?? `${raw.batches[0].batch_id}:relation:0`;
      const alias = `${first.from}->${first.to}`;
      raw.withdrawn.relationships = [alias];
      const preview = createProvisionalRelease(raw);
      assert.equal(
        preview.visibility().relationships.includes(id),
        explicit,
        "An arrow alias applies only when the original relation has no explicit ID",
      );
      const normalized = await scalar(
        admin,
        "SELECT noemap_private.normalize_document($1::jsonb)",
        [JSON.stringify(raw)],
      );
      const sortedWithdrawals = (value) =>
        Object.fromEntries(
          Object.entries(value).map(([category, entries]) => [
            category,
            [...entries].sort(),
          ]),
        );
      same(
        sortedWithdrawals(normalized.withdrawn),
        sortedWithdrawals(preview.normalizedWithdrawals()),
        "SQL and editor preview normalize the same tombstones",
      );
      assert.equal(
        createProvisionalRelease(normalized)
          .visibility()
          .relationships.includes(id),
        explicit,
        "Normalization preserves original alias meaning",
      );
      readerEquivalence(
        raw,
        await sqlProjection(raw),
        `original ${explicit ? "explicit" : "implicit"} arrow`,
      );
      readerEquivalence(
        raw,
        await sqlProjection(normalized),
        `normalized ${explicit ? "explicit" : "implicit"} arrow`,
      );
      if (explicit) {
        raw.withdrawn.relationships.push(id);
        assert.equal(
          createProvisionalRelease(raw).visibility().relationships.includes(id),
          false,
        );
        readerEquivalence(
          raw,
          await sqlProjection(raw),
          "explicit relation ID withdrawal",
        );
      }
    }
  });
  await test("P14 generated initial import applies to an empty DB and rejects repeat import without changes", async () => {
    const generated = prepareImport();
    assert.equal(generated.node_count, 36);
    const sql = await readFile(".local/persistent-initial-import.sql", "utf8");
    const client = await freshImportDatabase("noemap_initial_import_test");
    await client.query(sql);
    const publicReader = await connect(
      "anon",
      undefined,
      "noemap_initial_import_test",
    );
    const row = await publicRow(publicReader);
    assert.equal(Number(row.generation), 0);
    assert.equal(createProvisionalRelease(row.document).catalog().length, 36);
    readerEquivalence(original, row.document, "generated initial import");
    assert.equal(
      await scalar(
        client,
        "SELECT count(*)::integer FROM noemap_private.editors",
      ),
      0,
    );
    assert.equal(
      await scalar(
        client,
        "SELECT count(*)::integer FROM noemap_private.snapshots",
      ),
      1,
    );
    await assert.rejects(
      client.query(sql),
      (error) =>
        error.code === "P0001" && error.message.includes("already initialized"),
    );
    await client.query("ROLLBACK");
    same(
      await publicRow(publicReader),
      row,
      "Rejected repeat import leaves public state unchanged",
    );
    assert.equal(
      await scalar(
        client,
        "SELECT count(*)::integer FROM noemap_private.snapshots",
      ),
      1,
    );
  });
  await test("P15 generated backup import treats SQL delimiters as data and preserves current withdrawals in the private draft", async () => {
    const current = structuredClone(original);
    current.withdrawn.sources.push("hume-s-appendix");
    const marker = "'$noemap_import$' is a literal backup fixture";
    current.batches[0].node_candidates[0].summary_ja += ` ${marker}`;
    const draft = structuredClone(original);
    const draftMarker = `Private draft fixture ${marker}`;
    draft.batches[0].node_candidates[0].summary_ja += ` ${draftMarker}`;
    const fixturePath = resolve(directory, "backup-fixture.json");
    await writeFile(
      fixturePath,
      JSON.stringify({
        schema_version: 1,
        kind: "noemap-backup",
        human_review: "pending",
        current,
        draft,
      }),
    );
    const backupOutput = ".local/persistent-backup-import.sql";
    const priorOutput = await readFile(backupOutput, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    let sql;
    try {
      prepareImport(fixturePath);
      sql = await readFile(backupOutput, "utf8");
      await writeFile(resolve(directory, "generated-backup-import.sql"), sql);
    } finally {
      // Fixture exports belong to this disposable test directory. Preserve a
      // previously prepared real backup export instead of replacing it.
      if (priorOutput !== null) await writeFile(backupOutput, priorOutput);
      else
        await unlink(backupOutput).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    const client = await freshImportDatabase("noemap_backup_import_test");
    await client.query(sql);
    const row = await publicRow(
      await connect("anon", undefined, "noemap_backup_import_test"),
    );
    const privateState = (
      await client.query(
        "SELECT s.generation,c.document AS current,d.document AS draft FROM noemap_private.state s JOIN noemap_private.snapshots c ON c.id=s.current_snapshot_id LEFT JOIN noemap_private.snapshots d ON d.id=s.draft_snapshot_id WHERE s.id",
      )
    ).rows[0];
    assert.equal(Number(privateState.generation), 0);
    assert.ok(
      privateState.current.batches[0].node_candidates[0].summary_ja.includes(
        marker,
      ),
    );
    assert.ok(
      privateState.draft.batches[0].node_candidates[0].summary_ja.includes(
        draftMarker,
      ),
    );
    assert.ok(
      privateState.current.withdrawn.sources.includes("hume-s-appendix"),
    );
    assert.ok(
      privateState.draft.withdrawn.sources.includes("hume-s-appendix"),
      "Backup draft inherits published withdrawals even when the backup draft omitted them",
    );
    assert.equal(privateState.draft.human_review.status, "pending");
    readerEquivalence(current, row.document, "generated backup current");
    assert.equal(
      JSON.stringify(row.document).includes(draftMarker),
      false,
      "Restored draft remains private",
    );
    assert.equal(
      await scalar(
        client,
        "SELECT count(*)::integer FROM noemap_private.snapshots",
      ),
      2,
    );
    assert.equal(
      await scalar(
        client,
        "SELECT count(*)::integer FROM noemap_private.editors",
      ),
      0,
    );
    await assert.rejects(
      client.query(sql),
      (error) =>
        error.code === "P0001" && error.message.includes("already initialized"),
    );
    await client.query("ROLLBACK");
    assert.equal(
      await scalar(
        client,
        "SELECT count(*)::integer FROM noemap_private.snapshots",
      ),
      2,
    );
    // Retain the real initial import as the prepared operational artifact.
    prepareImport();
  });
} catch (error) {
  console.log(`Persistent DB setup/runner failure: ${error.message}`);
  if (error.where) console.log(error.where);
  results.push({
    name: "setup/runner",
    status: "failed",
    message: error.message,
    code: error.code,
    context: error.where,
  });
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => {})));
  if (started) await database.stop();
  const report = {
    scope: "disposable local PostgreSQL only; no remote Supabase or real Auth",
    status: results.some((r) => r.status === "failed") ? "failed" : "passed",
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
  await writeFile(
    resolve(directory, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await mkdir(resolve("docs", "validation"), { recursive: true });
  await writeFile(
    resolve("docs", "validation", "persistent-db-results.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scope: report.scope,
        fixture:
          "36 source-backed provisional nodes; pending human review; stub Auth users",
        migration:
          "supabase/migrations/20261003031858_noemap_persistent_snapshots.sql",
        postgres: postgresVersion ?? null,
        node: process.version,
        status: report.status,
        passed: report.passed,
        failed: report.failed,
        tests: results.map(({ name, status, duration_ms, message, code }) => ({
          name,
          status,
          duration_ms,
          ...(message ? { message } : {}),
          ...(code ? { sqlstate: code } : {}),
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      passed: report.passed,
      failed: report.failed,
      results_file: resolve(directory, "results.json"),
    }),
  );
}
// embedded-postgres has an async exit hook which otherwise exits with status 0.
// Every client and server is already stopped; preserve the test failure for CI.
if (process.exitCode) process.exit(process.exitCode);
