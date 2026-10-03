import { NextResponse } from "next/server";
import { session, sameOrigin } from "../../../server/session";
import { transaction } from "../../../server/database";
import { isUuid } from "../../../server/public";
import { configuration } from "../../../server/config";
import type { Role, RevisionDetail, Kind } from "../../../domain/types";
import { nodeCollections, type NodeType } from "../../../domain/nodes";
class InputError extends Error {}
const requirements: Record<string, Role[]> = {
  create: ["editor"],
  save: ["editor"],
  temporal: ["editor"],
  freeze: ["editor"],
  clone: ["editor"],
  review: ["reviewer"],
  publish: ["publisher"],
  revoke: ["publisher"],
  suspend: ["publisher"],
  resume: ["publisher"],
  withdraw: ["reviewer"],
  compose: ["reviewer", "publisher"],
};
export async function POST(request: Request) {
  if (!(await sameOrigin(request)))
    return new Response("この操作は許可されていません。", { status: 403 });
  const origin = (await configuration()).origin;
  const actor = await session();
  if (!actor)
    return new Response("編集画面にログインしてください。", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 150000)
    return new Response("入力が長すぎます。", { status: 413 });
  const form = await request.formData(),
    action = String(form.get("action") ?? ""),
    roles = requirements[action];
  if (!roles || roles.some((role) => !actor.roles.includes(role)))
    return new Response("この操作を行う権限がありません。", { status: 403 });
  let destination = "/editor";
  try {
    const field = (name: string, max = 2000, required = true) => {
      const v = form.get(name);
      if (v !== null && typeof v !== "string") throw new InputError();
      const result = (v ?? "").trim();
      if (result.length > max || (required && !result)) throw new InputError();
      return result;
    };
    const id = (name: string) => {
      const v = field(name, 36);
      if (!isUuid(v)) throw new InputError();
      return v;
    };
    const ids = (name: string) => {
      const values = form.getAll(name);
      if (
        values.length < 1 ||
        values.length > 30 ||
        values.some((v) => typeof v !== "string" || !isUuid(v))
      )
        throw new InputError();
      if (new Set(values).size !== values.length) throw new InputError();
      return values as string[];
    };
    const human = () => {
      if (form.get("human") !== "checked") throw new InputError();
    };
    const generation = () => {
      const v = field("generation", 18);
      if (!/^\d+$/.test(v)) throw new InputError();
      return v;
    };
    const year = (name: string) => {
      const raw = field(`${name}_year`, 10, false);
      if (!raw) return null;
      if (!/^[1-9]\d*$/.test(raw)) throw new InputError();
      const number = Number(raw),
        era = field(`${name}_era`, 3);
      if (
        !Number.isSafeInteger(number) ||
        number > 2147483647 ||
        !["bce", "ce"].includes(era)
      )
        throw new InputError();
      return era === "bce" ? 1 - number : number;
    };
    if (action !== "create") {
      destination = `/editor/revisions/${id("revision")}`;
      if (action === "compose")
        destination = `/editor/compose/${id("revision")}`;
    }
    destination = await transaction(actor.id, async (db) => {
      const one = async <T = string>(sql: string, args: unknown[] = []) =>
        Object.values((await db.query(sql, args)).rows[0] ?? {})[0] as T;
      if (action === "create") {
        const kind = field("kind", 20) as Kind;
        if (!["entity", "source", "assertion", "block"].includes(kind))
          throw new InputError();
        const variant =
          kind === "source"
            ? "edition"
            : kind === "assertion"
              ? "claim"
              : field("variant", 20);
        const reason = field("reason"),
          body = field(
            "text",
            kind === "entity" ? 200 : kind === "source" ? 300 : 20000,
          );
        if (
          (kind === "entity" &&
            !["question", "concept", "person", "work"].includes(variant)) ||
          (kind === "block" && !["summary", "comparison"].includes(variant))
        )
          throw new InputError();
        const revision = await one("SELECT api.create_draft($1,$2,$3)", [
          kind,
          variant,
          reason,
        ]);
        await one("SELECT api.put_text($1,'ja',$2,$3)", [
          revision,
          kind === "entity"
            ? "preferred"
            : kind === "source"
              ? "title"
              : "body",
          body,
        ]);
        if (kind === "entity")
          await one("SELECT api.put_entity($1,$2)", [revision, field("scope")]);
        if (kind === "source") {
          await one("SELECT api.put_source($1,$2,'ja')", [
            revision,
            field("citation", 3000),
          ]);
          const url = field("url", 2000, false);
          if (url && !/^https?:\/\//i.test(url)) throw new InputError();
          await one("SELECT api.source_metadata($1,$2,$3,$4,NULL)", [
            revision,
            field("edition", 300),
            field("publication_info", 1000),
            url || null,
          ]);
          const role = field("credit_role", 20);
          if (!["author", "editor", "translator", "publisher"].includes(role))
            throw new InputError();
          await one("SELECT api.source_credit($1,$2,$3)", [
            revision,
            role,
            field("credit", 300),
          ]);
        }
        if (kind === "assertion") {
          const nature = field("nature", 20),
            rationale = field("rationale");
          if (
            ![
              "position",
              "fact_report",
              "interpretation",
              "editorial",
            ].includes(nature)
          )
            throw new InputError();
          await one("SELECT api.put_assertion($1,$2,$3,$4)", [
            revision,
            id("subject"),
            nature,
            rationale,
          ]);
          if (nature === "editorial")
            await one("SELECT api.add_editorial_basis($1,$2,$3)", [
              revision,
              id("basis"),
              rationale,
            ]);
          else {
            const source = id("source"),
              evidence = await one(
                "SELECT api.add_evidence($1,$2,'supports',$3,$4)",
                [
                  revision,
                  source,
                  field("locator", 1000),
                  field("summary", 3000),
                ],
              );
            const speakerRole = field("speaker_role", 30);
            if (
              ![
                "original_statement",
                "quoted_person",
                "reported_position",
                "editor_note",
                "hypothesis",
              ].includes(speakerRole)
            )
              throw new InputError();
            await one("SELECT api.attribute($1,$2,$3,$4,$5,$6,NULL)", [
              revision,
              evidence,
              source,
              field("speaker", 300),
              speakerRole,
              field("context"),
            ]);
          }
        }
        if (kind === "block") {
          await one("SELECT api.put_block($1,$2,'ja')", [
            revision,
            id("entity"),
          ]);
          await one("SELECT api.replace_block_references($1,$2,$3)", [
            revision,
            ids("references"),
            [...body].length,
          ]);
        }
        return `/editor/revisions/${revision}`;
      }
      const revision = id("revision"),
        data = await one<RevisionDetail | null>(
          "SELECT api.editor_revision($1)",
          [revision],
        );
      if (!data) throw new InputError();
      switch (action) {
        case "temporal": {
          if (
            data.revision.kind !== "assertion" ||
            data.revision.variant !== "claim" ||
            data.revision.state !== "draft"
          )
            throw new InputError();
          const role = field("role", 20);
          if (
            !["birth", "death", "active", "publication", "founding"].includes(
              role,
            )
          )
            throw new InputError();
          await one(
            "SELECT api.put_temporal($1,$2,$3,$4,$5,'astronomical_year',$6,$7,$8,$9)",
            [
              revision,
              role,
              field("original_label", 2000),
              field("date_label", 1000),
              field("calendar", 120),
              year("start_earliest"),
              year("start_latest"),
              year("end_earliest"),
              year("end_latest"),
            ],
          );
          break;
        }
        case "save": {
          const body = field(
            "text",
            data.revision.kind === "entity"
              ? 200
              : data.revision.kind === "source"
                ? 300
                : 20000,
          );
          await one("SELECT api.put_text($1,'ja',$2,$3)", [
            revision,
            data.revision.kind === "entity"
              ? "preferred"
              : data.revision.kind === "source"
                ? "title"
                : "body",
            body,
          ]);
          if (data.revision.kind === "entity")
            await one("SELECT api.put_entity($1,$2)", [
              revision,
              field("scope"),
            ]);
          if (data.revision.kind === "source") {
            await one("SELECT api.put_source($1,$2,$3)", [
              revision,
              field("citation", 3000),
              data.source?.source_language ?? "ja",
            ]);
            const url = field("url", 2000, false);
            if (url && !/^https?:\/\//i.test(url)) throw new InputError();
            await one("SELECT api.source_metadata($1,$2,$3,$4,$5)", [
              revision,
              field("edition", 300),
              field("publication_info", 1000),
              url || null,
              data.source_metadata?.work_revision_id ?? null,
            ]);
          }
          if (data.revision.kind === "block")
            await one("SELECT api.replace_block_references($1,$2,$3)", [
              revision,
              ids("references"),
              [...body].length,
            ]);
          break;
        }
        case "freeze":
          await one("SELECT api.freeze($1)", [revision]);
          break;
        case "clone":
          return `/editor/revisions/${await one("SELECT api.clone_revision($1,$2)", [revision, field("reason")])}`;
        case "review": {
          human();
          const decision = field("decision", 10);
          if (!["approved", "rejected"].includes(decision))
            throw new InputError();
          await one("SELECT api.review($1,ARRAY['ja'],$2,$3)", [
            revision,
            decision,
            field("reason"),
          ]);
          break;
        }
        case "publish":
          await one("SELECT api.publish($1,$2,$3,$4)", [
            revision,
            id("review"),
            generation(),
            id("operation"),
          ]);
          break;
        case "revoke":
          await one("SELECT api.revoke($1,$2,$3,$4)", [
            revision,
            generation(),
            id("operation"),
            field("reason"),
          ]);
          break;
        case "suspend":
          await one("SELECT api.suspend($1,$2,$3,$4)", [
            data.revision.object_id,
            generation(),
            id("operation"),
            field("reason"),
          ]);
          break;
        case "resume":
          await one("SELECT api.resume($1,$2,$3,$4,$5)", [
            data.revision.object_id,
            ids("reviews"),
            generation(),
            id("operation"),
            field("reason"),
          ]);
          break;
        case "withdraw": {
          const review = id("review");
          if (!data.reviews.some((v) => v.id === review))
            throw new InputError();
          await one("SELECT api.withdraw_review($1,$2,$3,$4)", [
            review,
            generation(),
            id("operation"),
            field("reason"),
          ]);
          break;
        }
        case "compose": {
          const collection = nodeCollections[data.revision.variant as NodeType];
          if (!collection) throw new InputError();
          human();
          await one("SELECT api.release_page($1,'ja',$2,$3,$4,$5)", [
            revision,
            ids("blocks"),
            generation(),
            id("operation"),
            field("reason"),
          ]);
          return `/${collection}/${data.revision.object_id}`;
        }
      }
      return destination;
    });
    return NextResponse.redirect(
      new URL(
        `${destination}${destination.startsWith("/editor") ? "?done=1" : ""}`,
        origin,
      ),
      303,
    );
  } catch (error) {
    const e = error as Error;
    const code =
      e instanceof InputError
        ? "invalid"
        : /generation conflict|stale|operation id reused/.test(e.message)
          ? "conflict"
          : /unavailable|dependency|suspended/.test(e.message)
            ? "dependency"
            : /unauthorized|permission denied/.test(e.message)
              ? "permission"
              : "failed";
    return NextResponse.redirect(
      new URL(`${destination}?error=${code}`, origin),
      303,
    );
  }
}
