import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateEditableDocument,
  preserveWithdrawals,
} from "../src/domain/editable.ts";
import { projectPublicDocument } from "../src/domain/public-projection.ts";
import { createProvisionalRelease } from "../src/domain/provisional.ts";

// Prepare an import without a network connection, account creation, or grants
// to a real person. The destination must be chosen separately before applying.
const args = process.argv.slice(2);
const isBackup = args[0] === "--backup";
if (args.length && !(isBackup && args.length === 2))
  throw new Error(
    "Usage: node scripts/prepare-persistent-database.mjs [--backup FILE]",
  );
const backup = isBackup
  ? JSON.parse(await readFile(resolve(args[1]), "utf8"))
  : null;
if (
  backup &&
  (backup.schema_version !== 1 ||
    backup.kind !== "noemap-backup" ||
    backup.human_review !== "pending")
)
  throw new Error("Invalid NOEMAP content backup");
const document = backup
  ? backup.current
  : JSON.parse(
      await readFile(
        new URL("../src/data/public-release.json", import.meta.url),
        "utf8",
      ),
    );
validateEditableDocument(document);
let draft = backup?.draft ?? null;
if (draft) {
  validateEditableDocument(draft);
  draft = preserveWithdrawals(draft, document);
  validateEditableDocument(draft);
}
const projection = projectPublicDocument(document);
const count = createProvisionalRelease(projection).catalog().length;
if (!isBackup && count !== 36)
  throw new Error("Initial import must retain the existing 36 items");
const output = resolve(
  ".local",
  isBackup ? "persistent-backup-import.sql" : "persistent-initial-import.sql",
);
const data = JSON.stringify({ current: document, draft });
let tag, outerTag;
do {
  tag = `noemap_seed_${randomUUID().replaceAll("-", "")}`;
  outerTag = `noemap_import_${randomUUID().replaceAll("-", "")}`;
} while (data.includes(`$${tag}$`) || data.includes(`$${outerTag}$`));
const body = `BEGIN;
DO $${outerTag}$
DECLARE payload jsonb := $${tag}$${data}$${tag}$::jsonb;
  doc jsonb := payload->'current'; draft_doc jsonb := payload->'draft';
  version_id uuid := gen_random_uuid(); draft_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM noemap_private.state) OR EXISTS (SELECT 1 FROM public.noemap_public_release) THEN
    RAISE EXCEPTION 'NOEMAP is already initialized; import refused';
  END IF;
  PERFORM noemap_private.check_document(doc);
  doc := noemap_private.normalize_document(doc);
  INSERT INTO noemap_private.snapshots(id,document,actor_label,reason)
    VALUES(version_id,doc,'${isBackup ? "復旧データ" : "初期公開データ"}','${isBackup ? "JSONに保存された公開版を空のDBへ復旧。人による内容確認は未実施。" : "公開中の実資料36項目を移行。人による内容確認は未実施。"}');
  INSERT INTO noemap_private.state(id,generation,current_snapshot_id) VALUES(true,0,version_id);
  INSERT INTO public.noemap_public_release(id,generation,snapshot_id,document)
    VALUES(true,0,version_id,noemap_private.project_document(doc));
  IF draft_doc IS DISTINCT FROM 'null'::jsonb THEN
    PERFORM noemap_private.check_document(draft_doc);
    draft_doc := noemap_private.normalize_document(draft_doc);
    draft_id := gen_random_uuid();
    INSERT INTO noemap_private.snapshots(id,document,actor_label,reason)
      VALUES(draft_id,draft_doc,'復旧データ','JSONに保存された未公開の下書き。人による確認は未実施。');
    UPDATE noemap_private.state SET draft_snapshot_id=draft_id WHERE id;
  END IF;
END $${outerTag}$;
COMMIT;
`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, body, "utf8");
console.log(
  JSON.stringify({
    status: "prepared_locally",
    output,
    node_count: count,
    human_review: "pending",
    account_grants: 0,
    cloud_changes: 0,
  }),
);
