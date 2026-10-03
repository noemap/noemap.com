import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { runEditorialTests } from './editorial.mjs';
import { runEditorApiTests } from './editor-api.mjs';
import { runExplorationTests } from './exploration.mjs';
import { runChronologyTests } from './chronology.mjs';

// Each run uses its own cluster and real TCP connections. No cloud credentials.
const directory = resolve('.local', `db-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const port = await new Promise((done, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const selected = server.address().port;
    server.close(() => done(selected));
  });
});
const password = randomBytes(24).toString('hex');
const db = new EmbeddedPostgres({
  databaseDir: resolve(directory, 'data'), port, user: 'postgres', password,
  authMethod: 'scram-sha-256', persistent: true, createPostgresUser: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {}, onError: () => {},
});
const clients = [];
const results = [];
async function connect(user = 'postgres', dbName = 'noemap_test') {
  const c = new pg.Client({ host: '127.0.0.1', port, user, password, database: dbName,
    connectionTimeoutMillis: 10000, statement_timeout: 8000, lock_timeout: 5000 });
  await c.connect(); clients.push(c); return c;
}
async function scalar(client, sql, args = []) {
  return Object.values((await client.query(sql, args)).rows[0])[0];
}
async function rejects(fn, expression) {
  await assert.rejects(fn, expression);
}
async function test(name, fn) {
  const start = Date.now(); await fn();
  results.push({ name, status: 'passed', duration_ms: Date.now() - start });
  console.log(`PASS ${name}`);
}
let started = false;
try {
  await writeFile(resolve('.local', 'latest-test-results.json'), JSON.stringify({ status: 'running' }));
  await db.initialise(); await db.start(); started = true;
  if (process.argv.includes('--probe-failure-exit')) throw new Error('Intentional test runner failure probe');
  const bootstrap = await connect('postgres', 'postgres');
  await bootstrap.query('CREATE DATABASE noemap_test');
  const admin = await connect();
  await admin.query(await readFile('db/migrations/001-foundation.sql', 'utf8'));
  for (const role of ['editor', 'reviewer', 'publisher', 'reader', 'worker']) {
    // Names are fixed above and password is generated hex, never user input.
    await admin.query(`CREATE ROLE test_${role} LOGIN PASSWORD '${password}' IN ROLE nm_${role}`);
  }
  await admin.query("INSERT INTO publication.principals(db_role,can_review,can_publish) VALUES ('test_reviewer',true,false),('test_publisher',false,true)");
  const editor = await connect('test_editor');
  const reviewer = await connect('test_reviewer');
  const publisher = await connect('test_publisher');
  const reader = await connect('test_reader');
  const worker = await connect('test_worker');
  const publisher2 = await connect('test_publisher');
  const editor2 = await connect('test_editor');
  const version = await scalar(admin, 'SHOW server_version');
  console.log(`PostgreSQL ${version}; isolated cluster; separate runtime logins`);
  const object = rev => scalar(admin, 'SELECT object_id FROM knowledge.revisions WHERE id=$1', [rev]);
  const generation = rev => scalar(admin, 'SELECT o.generation FROM knowledge.objects o JOIN knowledge.revisions r ON r.object_id=o.id WHERE r.id=$1', [rev]);
  const create = (kind, variant, parent = null) => scalar(editor, 'SELECT api.create_draft($1,$2,$3,$4)', [kind, variant, '架空の自動試験データ', parent]);
  const text = (rev, role, content, lang = 'ja') => editor.query('SELECT api.put_text($1,$2,$3,$4)', [rev, lang, role, content]);
  const freeze = rev => editor.query('SELECT api.freeze($1)', [rev]);
  const review = (rev, langs = ['ja']) => scalar(reviewer, "SELECT api.review($1,$2,'approved','試験用の確認記録。実資料の承認ではない。')", [rev, langs]);
  const publish = async (rev, rid, gen, op = randomUUID(), connection = publisher) => scalar(connection, 'SELECT api.publish($1,$2,$3,$4)', [rev, rid ?? await review(rev), gen ?? await generation(rev), op]);
  const read = (rev, lang = 'ja') => scalar(reader, 'SELECT api.read_revision($1,$2)', [rev, lang]);
  const revoke = async rev => scalar(publisher, 'SELECT api.revoke($1,$2,$3,$4)', [rev, await generation(rev), randomUUID(), '試験上の根拠撤回']);
  async function entity(name, variant = 'person', parent = null) {
    const rev = await create('entity', variant, parent);
    await editor.query('SELECT api.put_entity($1,$2)', [rev, '架空の識別範囲']);
    await text(rev, 'preferred', name); await freeze(rev); return rev;
  }
  async function source(name, parent = null) {
    const rev = await create('source', 'edition', parent);
    await editor.query('SELECT api.put_source($1,$2,$3)', [rev, `${name}、架空刊行物、試験用版`, 'ja']);
    await text(rev, 'title', name); await freeze(rev); return rev;
  }
  async function assertion(subject, src, parent = null, target = null) {
    const rev = await create('assertion', target ? 'relationship' : 'claim', parent);
    await editor.query('SELECT api.put_assertion($1,$2,$3,$4,$5,$6,$7)',
      [rev, subject, target ? 'editorial' : 'position', '資料の限定された箇所による説明', target, target ? 'related_to_question' : null, target ? 1 : null]);
    await text(rev, 'body', 'これは架空の資料に基づく、試験用の立場です。');
    const eid = await scalar(editor, "SELECT api.add_evidence($1,$2,'supports','第2節','試験用の根拠要約')", [rev, src]);
    if (!target) await editor.query("SELECT api.add_attribution($1,$2,$3,'架空の発話者A')", [rev, eid, src]);
    return { rev, eid };
  }
  async function block(ent, assertionRev, body, parent = null) {
    const rev = await create('block', 'summary', parent);
    await editor.query("SELECT api.put_block($1,$2,'ja')", [rev, ent]);
    await text(rev, 'body', body);
    await editor.query('SELECT api.add_block_reference($1,$2,0,$3)', [rev, assertionRev, [...body].length]);
    await freeze(rev); return rev;
  }
  // Wait on actual lock evidence, not a timing assumption.
  async function waitBlocked(client, blocker) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await scalar(admin, 'SELECT $2::integer=ANY(pg_blocking_pids($1))', [client.processID, blocker.processID]);
      if (waiting) return;
      await new Promise(done => setTimeout(done, 20));
    }
    throw new Error('Expected database lock wait was not observed');
  }

  const person = await entity('架空の人物A');
  const question = await entity('私は誰なのか？（試験）', 'question');
  const source1 = await source('架空の資料A・旧版');
  await publish(person); await publish(question); await publish(source1);
  const source2 = await source('架空の資料A・新版', await object(source1));
  await publish(source2);
  const a = await assertion(person, source1);

  await test('B0-01 parent/revision and typed-kind constraints', async () => {
    const pid = await object(person);
    await rejects(() => admin.query('UPDATE knowledge.objects SET published_revision_id=$1 WHERE id=$2', [question, pid]), /foreign key/i);
    const wrong = await create('entity', 'concept');
    await rejects(() => editor.query("SELECT api.put_source($1,'invalid','ja')", [wrong]), /foreign key/i);
    await rejects(() => create('assertion', 'relationship', pid), /wrong object kind/);
  });
  await test('B0-02 attribution must match assertion AND source revision', async () => {
    await rejects(() => editor.query("SELECT api.add_attribution($1,$2,$3,'誤った帰属')", [a.rev, a.eid, source2]), /foreign key/i);
    const other = await assertion(person, source1);
    await rejects(() => editor.query("SELECT api.add_attribution($1,$2,$3,'誤った対象')", [other.rev, a.eid, source1]), /foreign key/i);
  });
  await freeze(a.rev);
  await test('B0-03 frozen body, details and evidence cannot change', async () => {
    await rejects(() => text(a.rev, 'body', '差し替え'), /frozen/);
    await rejects(() => editor.query("SELECT api.add_evidence($1,$2,'supports','p.9','後から追加')", [a.rev, source2]), /frozen/);
    await rejects(() => admin.query('DELETE FROM knowledge.evidence WHERE id=$1', [a.eid]), /frozen/);
    await rejects(() => admin.query("UPDATE knowledge.revisions SET reason='changed' WHERE id=$1", [a.rev]), /frozen/);
  });
  await test('B0-04 unapproved revision/language and rejected review stay private', async () => {
    assert.equal(await read(a.rev), null);
    const rejected = await scalar(reviewer, "SELECT api.review($1,ARRAY['ja'],'rejected','要修正')", [a.rev]);
    await rejects(() => publish(a.rev, rejected), /approved review/);
    await publish(a.rev);
    assert.equal((await read(a.rev)).revision_id, a.rev);
    assert.equal(await read(a.rev, 'en'), null);
    assert.equal(await read(randomUUID()), null);
    const dual = await create('entity', 'concept');
    await editor.query("SELECT api.put_entity($1,'試験用概念')", [dual]);
    await text(dual, 'preferred', '概念'); await text(dual, 'preferred', 'Concept', 'en'); await freeze(dual);
    await publish(dual);
    assert.equal(await read(dual, 'en'), null);
    await rejects(() => review(a.rev, ['en']), /language text missing/);
  });
  await test('B0-05 two publishers serialize; stale generation is rejected', async () => {
    const r1 = await entity('競合A'); const r2 = await entity('競合B', 'person', await object(r1));
    const review1 = await review(r1); const review2 = await review(r2);
    await publisher.query('BEGIN');
    try {
      await publish(r1, review1, 0);
      const pending = publish(r2, review2, 0, randomUUID(), publisher2).then(value => ({ value }), error => ({ error }));
      await waitBlocked(publisher2, publisher);
      await publisher.query('COMMIT');
      assert.match((await pending).error?.message ?? '', /generation conflict/);
      assert.equal((await scalar(reader, "SELECT api.read_current($1,'ja')", [await object(r1)])).revision_id, r1);
    } finally { await publisher.query('ROLLBACK'); }
  });
  const aNew = await assertion(person, source2, await object(a.rev)); await freeze(aNew.rev); await publish(aNew.rev);
  await test('B0-06 revoking old source hides its dependents, not independent newer versions', async () => {
    assert.ok(await read(a.rev)); assert.ok(await read(aNew.rev));
    await revoke(source1);
    assert.equal(await read(source1), null); assert.equal(await read(a.rev), null);
    assert.ok(await read(source2)); assert.ok(await read(aNew.rev));
  });
  await test('B0-07 repeated operation returns receipt without duplicate audit/outbox/grant', async () => {
    const r = await entity('再送'); const v = await review(r); const op = randomUUID();
    const first = await publish(r, v, 0, op);
    assert.deepEqual(await publish(r, v, 0, op), first);
    for (const table of ['receipts','audit','outbox']) {
      assert.equal(await scalar(admin, `SELECT count(*)::int FROM publication.${table} WHERE operation_id=$1`, [op]), 1);
    }
    assert.equal(await scalar(admin, 'SELECT count(*)::int FROM publication.grants WHERE revision_id=$1', [r]), 1);
    await rejects(() => publish(r, v, 1, op), /different input/);
  });
  await test('B0-08 read failure raises error instead of returning previously read content', async () => {
    assert.ok(await read(aNew.rev));
    await admin.query('REVOKE SELECT ON publication.grants FROM nm_read_owner');
    try { await rejects(() => read(aNew.rev), /permission denied/); }
    finally { await admin.query('GRANT SELECT ON publication.grants TO nm_read_owner'); }
    assert.ok(await read(aNew.rev));
  });
  await test('P04 runtime roles cannot bypass API or impersonate a reviewer', async () => {
    for (const c of [reader, editor, reviewer, publisher, worker]) {
      await rejects(() => c.query('SELECT * FROM knowledge.revisions'), /permission denied/);
      await rejects(() => c.query("UPDATE publication.grants SET revoked_at=NULL"), /permission denied/);
      await rejects(() => c.query('SET ROLE nm_owner'), /permission denied/);
    }
    await rejects(() => scalar(editor, "SELECT api.review($1,ARRAY['ja'],'approved','fake')", [aNew.rev]), /permission denied/);
    await rejects(() => scalar(worker, 'SELECT api.publish($1,$2,0,$3)', [aNew.rev, randomUUID(), randomUUID()]), /permission denied/);
    await admin.query("UPDATE publication.principals SET active=false WHERE db_role='test_publisher'");
    try { await rejects(() => publish(aNew.rev, randomUUID()), /unauthorized/); }
    finally { await admin.query("UPDATE publication.principals SET active=true WHERE db_role='test_publisher'"); }
  });
  await test('P05 freeze and late evidence insertion use the same real row lock', async () => {
    const c = await assertion(person, source2);
    await editor.query('BEGIN');
    try {
      await freeze(c.rev);
      const pending = editor2.query("SELECT api.add_evidence($1,$2,'qualifies','p.3','遅れて到着')", [c.rev, source2]).then(value => ({ value }), error => ({ error }));
      await waitBlocked(editor2, editor);
      await editor.query('COMMIT');
      assert.match((await pending).error?.message ?? '', /frozen/);
    } finally { await editor.query('ROLLBACK'); }
  });
  await test('publication transaction rollback includes grant/pointer/audit/outbox', async () => {
    const r = await entity('取消取引'); const v = await review(r); const op = randomUUID();
    await publisher.query('BEGIN'); await publish(r, v, 0, op); await publisher.query('ROLLBACK');
    assert.equal(await read(r), null); assert.equal(await generation(r), '0');
    for (const table of ['receipts','audit','outbox']) assert.equal(await scalar(admin, `SELECT count(*)::int FROM publication.${table} WHERE operation_id=$1`, [op]), 0);
    assert.equal(await scalar(admin, 'SELECT count(*)::int FROM publication.grants WHERE revision_id=$1', [r]), 0);
  });
  await test('stale dependency review requires a fresh human review', async () => {
    const s = await source('改訂依存・初版'); await publish(s);
    const c = await assertion(person, s); await freeze(c.rev); const reviewed = await review(c.rev);
    const next = await source('改訂依存・新版', await object(s)); await publish(next);
    await rejects(() => publish(c.rev, reviewed), /dependencies changed/);
    await publish(c.rev); assert.ok(await read(c.rev));
  });
  await test('revocation before concurrent publish rejects the waiting publisher', async () => {
    const s = await source('同時取消し根拠'); await publish(s);
    const c = await assertion(person, s); await freeze(c.rev); const reviewed = await review(c.rev);
    await publisher.query('BEGIN');
    try {
      await revoke(s);
      const pending = publish(c.rev, reviewed, 0, randomUUID(), publisher2).then(value => ({ value }), error => ({ error }));
      await waitBlocked(publisher2, publisher); await publisher.query('COMMIT');
      assert.match((await pending).error?.message ?? '', /dependencies changed|dependency unavailable/);
      assert.equal(await read(c.rev), null);
    } finally { await publisher.query('ROLLBACK'); }
  });
  await test('publish before concurrent revocation is visible only until revocation commits', async () => {
    const s = await source('公開先行の根拠'); await publish(s);
    const c = await assertion(person, s); await freeze(c.rev); const reviewed = await review(c.rev);
    await publisher.query('BEGIN');
    try {
      await publish(c.rev, reviewed);
      const pending = scalar(publisher2, 'SELECT api.revoke($1,$2,$3,$4)', [s, await generation(s), randomUUID(), '後続の根拠取消し'])
        .then(value => ({ value }), error => ({ error }));
      await waitBlocked(publisher2, publisher);
      assert.equal(await read(c.rev), null); // uncommitted publication is invisible
      await publisher.query('COMMIT');
      assert.ok((await pending).value);
      assert.equal(await read(c.rev), null);
    } finally { await publisher.query('ROLLBACK'); }
  });
  await test('P03 A to B to A does not make an old expected generation valid again', async () => {
    const a = await entity('A版'); await publish(a);
    const stale = await generation(a);
    const b = await entity('B版', 'person', await object(a)); await publish(b);
    await revoke(a); await publish(a);
    assert.equal((await scalar(reader, "SELECT api.read_current($1,'ja')", [await object(a)])).revision_id, a);
    const nextReview = await review(b);
    await rejects(() => publish(b, nextReview, stale), /generation conflict/);
  });
  await test('revoked review cannot be reused; a new grant needs a new review', async () => {
    const r = await entity('再審査対象'); const v = await review(r); await publish(r, v); await revoke(r);
    await rejects(() => publish(r, v), /unique constraint/);
    await publish(r); assert.ok(await read(r));
  });
  await test('read/write APIs reject old transaction snapshots', async () => {
    await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try { await rejects(() => read(person), /READ COMMITTED/); } finally { await reader.query('ROLLBACK'); }
    await publisher.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try { await rejects(() => publish(person, randomUUID()), /READ COMMITTED/); } finally { await publisher.query('ROLLBACK'); }
  });
  await test('relationship predicate pins its definition and enforces target type', async () => {
    const relation = await assertion(person, source2, null, question); await freeze(relation.rev); await publish(relation.rev);
    assert.ok(await read(relation.rev));
    const wrong = await assertion(person, source2, null, person);
    await rejects(() => freeze(wrong.rev), /target must be a question/);
  });
  await test('block owner/language remain stable and ranges count Unicode code points', async () => {
    const b1 = await block(person, aNew.rev, '😀');
    const b2 = await create('block', 'summary', await object(b1));
    await rejects(() => editor.query("SELECT api.put_block($1,$2,'ja')", [b2, question]), /foreign key/);
    await rejects(() => editor.query("SELECT api.put_block($1,$2,'en')", [b2, person]), /foreign key/);
    const invalid = await create('block', 'summary');
    await editor.query("SELECT api.put_block($1,$2,'ja')", [invalid, person]);
    await text(invalid, 'body', '😀');
    await editor.query('SELECT api.add_block_reference($1,$2,0,2)', [invalid, aNew.rev]);
    await rejects(() => freeze(invalid), /invalid range/);
  });
  await test('P06 page reads its approved bundle even after block latest pointer changes', async () => {
    const b1 = await block(person, aNew.rev, '比較前の説明😀'); await publish(b1);
    const page = await scalar(reviewer, "SELECT api.review_page($1,'ja',$2,'組合せの確認')", [person, [b1]]);
    await publisher.query('SELECT api.publish_page($1,0,$2)', [page, randomUUID()]);
    const b2 = await block(person, aNew.rev, '別の新しい説明', await object(b1)); await publish(b2);
    const displayed = await scalar(reader, "SELECT api.read_page($1,'ja')", [await object(person)]);
    assert.equal(displayed.blocks[0].revision_id, b1);
    assert.equal(displayed.blocks[0].texts[0].content, '比較前の説明😀');
    await revoke(b1);
    assert.equal(await scalar(reader, "SELECT api.read_page($1,'ja')", [await object(person)]), null);
    assert.ok(await read(b2));
    await rejects(() => scalar(reviewer, "SELECT api.review_page($1,'ja',$2,'誤った主題')", [question, [b2]]), /wrong ownership/);
  });
  await test('suspension stops all versions and has no accidental resume endpoint', async () => {
    await publisher.query('SELECT api.suspend($1,$2,$3,$4)', [await object(source2), await generation(source2), randomUUID(), '資料全体の再確認']);
    assert.equal(await read(source2), null); assert.equal(await read(aNew.rev), null);
    assert.equal(await scalar(admin, "SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api' AND p.proname IN ('resume','unsuspend')"), 0);
  });

  await admin.query(await readFile('db/migrations/002-editorial-foundation.sql', 'utf8'));
  await admin.query("INSERT INTO publication.principals(db_role,can_edit) VALUES ('test_editor',true) ON CONFLICT(db_role) DO UPDATE SET can_edit=true");
  await runEditorialTests({ admin,editor,reviewer,publisher,reader,create,text,freeze,review,publish,read,revoke,entity,source,assertion,block,object,generation,scalar,test,rejects });
  await admin.query(await readFile('db/migrations/003-editorial-api.sql','utf8'));
  await admin.query(`CREATE ROLE test_operator LOGIN PASSWORD '${password}' IN ROLE nm_editor,nm_reviewer,nm_publisher`);
  await admin.query("INSERT INTO publication.principals(db_role,can_edit,can_review,can_publish) VALUES('test_operator',true,true,true)");
  const operator=await connect('test_operator');
  await runEditorApiTests({admin,operator,editor,reader,scalar,test,rejects});
  await admin.query(await readFile('db/migrations/004-editor-search.sql','utf8'));
  await test('F07 editor search pages old records and separates published from frozen dependencies',async()=>{
    for(let i=0;i<102;i++){const rev=await scalar(operator,"SELECT api.create_draft('entity','concept','検索用の架空例')");await operator.query("SELECT api.put_text($1,'ja','preferred',$2)",[rev,`検索用例${i}`]);}
    const first=await scalar(operator,"SELECT api.editor_search('検索用例','entity','draft',0)");
    const second=await scalar(operator,"SELECT api.editor_search('検索用例','entity','draft',100)");
    assert.equal(first.total,102);assert.equal(first.items.length,100);assert.equal(second.items.length,2);assert.ok(!first.items.some(a=>second.items.some(b=>a.id===b.id)));assert.ok(first.items.every(x=>x.published===false));
    const old=await scalar(operator,"SELECT api.editor_search('私は誰なのか','entity','frozen',0)");assert.ok(old.items.length);assert.equal(old.items[0].published,true);
    await rejects(()=>scalar(reader,"SELECT api.editor_search('',NULL,NULL,0)"),/permission denied/);
    await rejects(()=>scalar(operator,"SELECT api.editor_search('',NULL,NULL,-1)"),/invalid search/);
  });

  await admin.query(await readFile('db/migrations/005-exploration.sql','utf8'));
  await runExplorationTests({admin,operator,editor,reader,scalar,test,rejects});
  await admin.query(await readFile('db/migrations/006-chronology.sql','utf8'));
  await runChronologyTests({admin,operator,editor,reviewer,publisher,reader,create,text,freeze,review,publish,read,revoke,entity,source,assertion,block,object,generation,scalar,test,rejects});

  const report = { generated_at: new Date().toISOString(), postgres: version, node: process.version,
    scope: 'Local DB integration tests for migrations 001–006; fictional data; not production, load or recovery certification',
    passed: results.length, tests: results };
  await writeFile(resolve(directory, 'results.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve('.local', 'latest-test-results.json'), JSON.stringify(report, null, 2));
  console.log(`${results.length} integration checks passed. Report: .local/latest-test-results.json`);
} catch (error) {
  console.error(error); process.exitCode = 1;
  await writeFile(resolve('.local', 'latest-test-results.json'), JSON.stringify({ status: 'failed', passed: results.length, error: error.message, tests: results }, null, 2));
} finally {
  for (const c of clients.reverse()) await c.end().catch(() => {});
  if (started) await db.stop();
}
// embedded-postgres uses async-exit-hook, whose beforeExit hook otherwise exits 0.
// Cleanup has finished; preserve a failing test's nonzero exit status for CI.
if (process.exitCode) process.exit(process.exitCode);
