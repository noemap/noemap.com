import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createPersistentStore,
  loadPublicSnapshot,
  persistentConfiguration,
  PersistentStoreError,
} from "../src/server/persistent-store.ts";
import { createProvisionalRelease } from "../src/domain/provisional.ts";

const document = JSON.parse(
  await readFile(
    new URL("../src/data/public-release.json", import.meta.url),
    "utf8",
  ),
);
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://mock-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_mock_for_tests",
};
const row = () => ({
  generation: 4,
  snapshot_id: "12345678-1234-4123-8123-123456789abc",
  document: structuredClone(document),
});
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const errorCode = (code) => (error) =>
  error instanceof PersistentStoreError &&
  error.code === code &&
  error.message === "NOEMAP_PERSISTENT_STORE_UNAVAILABLE";

test("only completely absent configuration selects the checked-in release", async () => {
  let requests = 0;
  const request = async () => {
    requests += 1;
    throw new Error("must not request");
  };
  assert.equal(persistentConfiguration({}), null);
  assert.equal(await loadPublicSnapshot({ env: {}, request }), null);
  assert.equal(requests, 0);
  for (const env of [
    { NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL },
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    },
    { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  ]) {
    assert.throws(
      () => persistentConfiguration(env),
      errorCode("configuration"),
    );
    await assert.rejects(
      loadPublicSnapshot({ env, request }),
      errorCode("configuration"),
    );
  }
  assert.equal(requests, 0);
});

test("public reads use only a publishable key, the singleton projection and no-store fetch", async () => {
  const config = persistentConfiguration(environment);
  let observed;
  const request = async (url, init) => {
    observed = { url: new URL(url), init };
    return response([row()]);
  };
  const snapshot = await createPersistentStore(
    config,
    request,
  ).readPublicSnapshot();
  assert.equal(snapshot.generation, 4);
  assert.equal(snapshot.document.human_review.status, "pending");
  assert.equal(
    createProvisionalRelease(snapshot.document).catalog().length,
    36,
  );
  assert.equal(observed.url.origin, environment.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(observed.url.pathname, "/rest/v1/noemap_public_release");
  assert.equal(
    observed.url.searchParams.get("select"),
    "generation,snapshot_id,document",
  );
  assert.equal(observed.url.searchParams.get("id"), "eq.true");
  assert.equal(observed.init.method, "GET");
  assert.equal(
    observed.init.headers.apikey,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  assert.equal(observed.init.headers.Authorization, undefined);
  assert.equal(observed.init.headers.authorization, undefined);
  assert.equal(observed.init.cache, "no-store");
  assert.equal(observed.init.credentials, "omit");
  assert.equal(observed.init.redirect, "error");
  assert.ok(observed.init.signal instanceof AbortSignal);
});

test("an outage after a successful read cannot reuse the old snapshot", async () => {
  let reads = 0;
  const request = async () => {
    reads += 1;
    if (reads === 1) return response([row()]);
    throw new Error("network error with sensitive upstream detail");
  };
  const store = createPersistentStore(
    persistentConfiguration(environment),
    request,
  );
  assert.equal((await store.readPublicSnapshot()).generation, 4);
  await assert.rejects(store.readPublicSnapshot(), errorCode("unavailable"));
  await assert.rejects(
    loadPublicSnapshot({ env: environment, request }),
    errorCode("unavailable"),
  );
  assert.equal(reads, 3);
});

test("empty heads, authorization errors and unavailable Data API fail closed", async () => {
  await assert.rejects(
    loadPublicSnapshot({ env: environment, request: async () => response([]) }),
    errorCode("not_initialized"),
  );
  for (const status of [401, 403, 404, 500, 503])
    await assert.rejects(
      loadPublicSnapshot({
        env: environment,
        request: async () => response({ message: "upstream detail" }, status),
      }),
      errorCode("unavailable"),
    );
});

test("published projection rejects malformed envelopes and invented human approval", async () => {
  const invalidRows = [
    { ...row(), generation: -1 },
    { ...row(), generation: "4" },
    { ...row(), snapshot_id: "unversioned" },
    { ...row(), document: null },
  ];
  const approved = row();
  approved.document.human_review = {
    status: "approved",
    reviewer: "AI",
    approved_at: "2026-10-03",
  };
  invalidRows.push(approved);
  const rawWithdrawn = row();
  rawWithdrawn.document.withdrawn.sources.push("hume-s-appendix");
  invalidRows.push(rawWithdrawn);
  for (const value of invalidRows)
    await assert.rejects(
      loadPublicSnapshot({
        env: environment,
        request: async () => response([value]),
      }),
      errorCode("invalid_snapshot"),
    );
  for (const value of [row(), [row(), row()], null])
    await assert.rejects(
      loadPublicSnapshot({
        env: environment,
        request: async () => response(value),
      }),
      errorCode("invalid_snapshot"),
    );
  await assert.rejects(
    loadPublicSnapshot({
      env: environment,
      request: async () => new Response("not json"),
    }),
    errorCode("invalid_snapshot"),
  );
});

test("public configuration rejects secret keys, URL credentials and redirects before any request", () => {
  for (const [url, key] of [
    [environment.NEXT_PUBLIC_SUPABASE_URL, "sb_secret_mock_do_not_use"],
    [environment.NEXT_PUBLIC_SUPABASE_URL, "legacy.jwt.service-role"],
    [
      "http://mock-project.supabase.co",
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
    [
      "https://user:password@mock-project.supabase.co",
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
    [
      "https://mock-project.supabase.co/rest/v1",
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
    [
      "https://mock-project.supabase.co/?apikey=unsafe",
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
  ]) {
    assert.throws(
      () =>
        persistentConfiguration({
          NEXT_PUBLIC_SUPABASE_URL: url,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
        }),
      errorCode("configuration"),
    );
  }
});

test("each public read fetches a new generation without a process cache", async () => {
  let generation = 0;
  const request = async () =>
    response([{ ...row(), generation: ++generation }]);
  const store = createPersistentStore(
    persistentConfiguration(environment),
    request,
  );
  assert.equal((await store.readPublicSnapshot()).generation, 1);
  assert.equal((await store.readPublicSnapshot()).generation, 2);
  assert.equal(
    (await loadPublicSnapshot({ env: environment, request })).generation,
    3,
  );
});
