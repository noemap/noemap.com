import type { ProvisionalReleaseInput } from "../domain/provisional";

export interface PersistentConfiguration {
  url: string;
  publishableKey: string;
}
export interface PublicSnapshot {
  generation: number;
  snapshot_id: string;
  document: ProvisionalReleaseInput;
}
type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;
type StoreErrorCode =
  "configuration" | "unavailable" | "not_initialized" | "invalid_snapshot";

// This transport accepts only public application keys. Database passwords,
// service-role keys and editor sessions are outside the public read contract.
export class PersistentStoreError extends Error {
  code: StoreErrorCode;
  constructor(code: StoreErrorCode) {
    super("NOEMAP_PERSISTENT_STORE_UNAVAILABLE");
    this.name = "PersistentStoreError";
    this.code = code;
  }
}

export function persistentConfiguration(
  env: Environment = process.env,
): PersistentConfiguration | null {
  const configuredUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const configuredKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Only an entirely absent configuration opts into the checked-in release.
  if (configuredUrl === undefined && configuredKey === undefined) return null;
  if (!configuredUrl || !configuredKey)
    throw new PersistentStoreError("configuration");
  const urlText = configuredUrl.trim();
  const publishableKey = configuredKey.trim();
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new PersistentStoreError("configuration");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) ||
    publishableKey.length > 512
  )
    throw new PersistentStoreError("configuration");
  return { url: url.origin, publishableKey };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readSnapshot(value: unknown): PublicSnapshot {
  if (!Array.isArray(value)) throw new PersistentStoreError("invalid_snapshot");
  if (value.length === 0) throw new PersistentStoreError("not_initialized");
  if (value.length !== 1 || !record(value[0]))
    throw new PersistentStoreError("invalid_snapshot");
  const row = value[0];
  const document = row.document;
  const humanReview = record(document) ? document.human_review : null;
  const withdrawn = record(document) ? document.withdrawn : null;
  if (
    !Number.isSafeInteger(row.generation) ||
    (row.generation as number) < 0 ||
    typeof row.snapshot_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.snapshot_id,
    ) ||
    !record(document) ||
    document.schema_version !== 1 ||
    typeof document.release_id !== "string" ||
    !document.release_id.trim() ||
    document.publication_status !== "provisional" ||
    document.authorized_by !== "project-owner-request" ||
    !record(humanReview) ||
    humanReview.status !== "pending" ||
    humanReview.reviewer !== null ||
    humanReview.approved_at !== null ||
    !Array.isArray(document.batches) ||
    !document.batches.length ||
    !Array.isArray(document.temporal_records) ||
    !record(withdrawn) ||
    !["sources", "nodes", "assertions", "relationships"].every(
      (category) =>
        Array.isArray(withdrawn[category]) && withdrawn[category].length === 0,
    )
  )
    throw new PersistentStoreError("invalid_snapshot");
  // Full reference, evidence and visibility validation belongs to the same
  // createProvisionalRelease adapter used for the checked-in release.
  return row as unknown as PublicSnapshot;
}

export function createPersistentStore(
  configuration: PersistentConfiguration,
  request: Fetcher = fetch,
) {
  // Validate injected configurations as strictly as environment configuration.
  const config = persistentConfiguration({
    NEXT_PUBLIC_SUPABASE_URL: configuration.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: configuration.publishableKey,
  })!;
  return {
    async readPublicSnapshot(): Promise<PublicSnapshot> {
      const url = new URL("/rest/v1/noemap_public_release", config.url);
      url.searchParams.set("select", "generation,snapshot_id,document");
      url.searchParams.set("id", "eq.true");
      let response: Response;
      try {
        response = await request(url.toString(), {
          method: "GET",
          headers: {
            apikey: config.publishableKey,
            Accept: "application/json",
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(6000),
        });
      } catch {
        throw new PersistentStoreError("unavailable");
      }
      if (!response.ok) throw new PersistentStoreError("unavailable");
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PersistentStoreError("invalid_snapshot");
      }
      return readSnapshot(payload);
    },
  };
}

export async function loadPublicSnapshot(
  options: { env?: Environment; request?: Fetcher } = {},
): Promise<PublicSnapshot | null> {
  const config = persistentConfiguration(options.env ?? process.env);
  return config
    ? createPersistentStore(
        config,
        options.request ?? fetch,
      ).readPublicSnapshot()
    : null;
}
