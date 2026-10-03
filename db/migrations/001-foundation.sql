-- B0: run once in a NEW isolated PostgreSQL database as migration administrator.
BEGIN;
CREATE ROLE nm_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE nm_read_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE nm_editor NOLOGIN;
CREATE ROLE nm_reviewer NOLOGIN;
CREATE ROLE nm_publisher NOLOGIN;
CREATE ROLE nm_reader NOLOGIN;
CREATE ROLE nm_worker NOLOGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA knowledge AUTHORIZATION nm_owner;
CREATE SCHEMA publication AUTHORIZATION nm_owner;
CREATE SCHEMA api AUTHORIZATION nm_owner;
SET ROLE nm_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE knowledge.languages (tag text PRIMARY KEY);
INSERT INTO knowledge.languages VALUES ('ja'), ('en');
CREATE TABLE knowledge.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  variant text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended')),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  current_revision_id uuid,
  published_revision_id uuid,
  UNIQUE (id,kind,variant),
  CHECK ((kind='entity' AND variant IN ('question','person','work','concept')) OR
         (kind='source' AND variant='edition') OR
         (kind='assertion' AND variant IN ('claim','relationship')) OR
         (kind='block' AND variant IN ('summary','comparison')))
);
CREATE TABLE knowledge.revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id uuid NOT NULL,
  kind text NOT NULL,
  variant text NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','frozen')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_by name NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  frozen_at timestamptz,
  UNIQUE (object_id,id), UNIQUE (object_id,revision_no), UNIQUE (id,kind),
  FOREIGN KEY (object_id,kind,variant) REFERENCES knowledge.objects(id,kind,variant),
  CHECK ((state='draft')=(frozen_at IS NULL))
);
ALTER TABLE knowledge.objects ADD FOREIGN KEY (id,current_revision_id) REFERENCES knowledge.revisions(object_id,id);
ALTER TABLE knowledge.objects ADD FOREIGN KEY (id,published_revision_id) REFERENCES knowledge.revisions(object_id,id);
CREATE TABLE knowledge.texts (
  revision_id uuid NOT NULL REFERENCES knowledge.revisions,
  language text NOT NULL REFERENCES knowledge.languages,
  role text NOT NULL CHECK (role IN ('preferred','alias','title','body')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 100000),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
-- Body text is deliberately not included in any btree key.
CREATE UNIQUE INDEX texts_single ON knowledge.texts(revision_id,language,role) WHERE role <> 'alias';
CREATE INDEX texts_revision ON knowledge.texts(revision_id);
CREATE TABLE knowledge.entities (
  revision_id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'entity' CHECK (kind='entity'),
  identity_scope text NOT NULL CHECK (length(btrim(identity_scope)) BETWEEN 1 AND 4000),
  FOREIGN KEY (revision_id,kind) REFERENCES knowledge.revisions(id,kind)
);
CREATE TABLE knowledge.sources (
  revision_id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'source' CHECK (kind='source'),
  citation text NOT NULL CHECK (length(btrim(citation)) BETWEEN 1 AND 4000),
  source_language text NOT NULL REFERENCES knowledge.languages,
  FOREIGN KEY (revision_id,kind) REFERENCES knowledge.revisions(id,kind)
);
CREATE TABLE knowledge.predicates (
  code text NOT NULL, version integer NOT NULL CHECK(version>0),
  meaning text NOT NULL, PRIMARY KEY(code,version)
);
INSERT INTO knowledge.predicates VALUES ('related_to_question',1,'編集者が資料の根拠を示して問いとの関連を説明する。影響や同意を意味しない。');
CREATE TABLE knowledge.assertions (
  revision_id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'assertion' CHECK (kind='assertion'),
  subject_revision_id uuid NOT NULL REFERENCES knowledge.entities,
  target_revision_id uuid REFERENCES knowledge.entities,
  nature text NOT NULL CHECK(nature IN ('fact_report','position','interpretation','editorial')),
  predicate_code text, predicate_version integer,
  rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),
  FOREIGN KEY (revision_id,kind) REFERENCES knowledge.revisions(id,kind),
  FOREIGN KEY (predicate_code,predicate_version) REFERENCES knowledge.predicates MATCH FULL,
  CHECK ((target_revision_id IS NULL)=(predicate_code IS NULL))
);
CREATE INDEX assertions_subject ON knowledge.assertions(subject_revision_id);
CREATE INDEX assertions_target ON knowledge.assertions(target_revision_id);
CREATE TABLE knowledge.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES knowledge.assertions,
  source_revision_id uuid NOT NULL REFERENCES knowledge.sources,
  role text NOT NULL CHECK(role IN ('supports','opposes','qualifies')),
  locator text NOT NULL CHECK(length(btrim(locator)) BETWEEN 1 AND 2000),
  summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 4000),
  UNIQUE(id,revision_id,source_revision_id)
);
CREATE INDEX evidence_revision ON knowledge.evidence(revision_id);
CREATE INDEX evidence_source ON knowledge.evidence(source_revision_id);
CREATE TABLE knowledge.attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES knowledge.assertions,
  evidence_id uuid NOT NULL,
  reporting_source_revision_id uuid NOT NULL,
  speaker_label text NOT NULL CHECK(length(btrim(speaker_label)) BETWEEN 1 AND 1000),
  FOREIGN KEY(evidence_id,revision_id,reporting_source_revision_id)
    REFERENCES knowledge.evidence(id,revision_id,source_revision_id)
);
CREATE INDEX attributions_evidence ON knowledge.attributions(evidence_id,revision_id,reporting_source_revision_id);
CREATE INDEX attributions_revision ON knowledge.attributions(revision_id);
CREATE TABLE knowledge.block_identities (
  object_id uuid PRIMARY KEY REFERENCES knowledge.objects,
  entity_id uuid NOT NULL REFERENCES knowledge.objects,
  language text NOT NULL REFERENCES knowledge.languages,
  UNIQUE(object_id,entity_id,language)
);
CREATE TABLE knowledge.blocks (
  revision_id uuid PRIMARY KEY,
  kind text NOT NULL DEFAULT 'block' CHECK(kind='block'),
  object_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  entity_revision_id uuid NOT NULL REFERENCES knowledge.entities,
  language text NOT NULL REFERENCES knowledge.languages,
  FOREIGN KEY(revision_id,kind) REFERENCES knowledge.revisions(id,kind),
  FOREIGN KEY(object_id,revision_id) REFERENCES knowledge.revisions(object_id,id),
  FOREIGN KEY(entity_id,entity_revision_id) REFERENCES knowledge.revisions(object_id,id),
  FOREIGN KEY(object_id,entity_id,language) REFERENCES knowledge.block_identities(object_id,entity_id,language)
);
CREATE INDEX blocks_entity ON knowledge.blocks(entity_revision_id);
CREATE TABLE knowledge.block_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES knowledge.blocks,
  assertion_revision_id uuid NOT NULL REFERENCES knowledge.assertions,
  start_cp integer NOT NULL CHECK(start_cp>=0),
  end_cp integer NOT NULL CHECK(end_cp>start_cp)
);
CREATE INDEX block_refs_revision ON knowledge.block_references(revision_id);
CREATE INDEX block_refs_assertion ON knowledge.block_references(assertion_revision_id);

CREATE VIEW knowledge.dependencies AS
 SELECT revision_id,subject_revision_id AS target FROM knowledge.assertions
 UNION SELECT revision_id,target_revision_id FROM knowledge.assertions WHERE target_revision_id IS NOT NULL
 UNION SELECT revision_id,source_revision_id FROM knowledge.evidence
 UNION SELECT revision_id,entity_revision_id FROM knowledge.blocks
 UNION SELECT revision_id,assertion_revision_id FROM knowledge.block_references;

CREATE TABLE publication.control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), epoch bigint NOT NULL DEFAULT 0
);
INSERT INTO publication.control DEFAULT VALUES;
CREATE TABLE publication.principals (
 db_role name PRIMARY KEY, active boolean NOT NULL DEFAULT true,
 can_review boolean NOT NULL DEFAULT false, can_publish boolean NOT NULL DEFAULT false
);
CREATE TABLE publication.reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL REFERENCES knowledge.revisions,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 reviewer name NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,revision_id)
);
CREATE TABLE publication.review_languages (
 review_id uuid NOT NULL REFERENCES publication.reviews,
 language text NOT NULL REFERENCES knowledge.languages,
 PRIMARY KEY(review_id,language)
);
CREATE TABLE publication.review_dependencies (
 review_id uuid NOT NULL REFERENCES publication.reviews,
 revision_id uuid NOT NULL REFERENCES knowledge.revisions,
 generation bigint NOT NULL, PRIMARY KEY(review_id,revision_id)
);
CREATE INDEX review_deps_revision ON publication.review_dependencies(revision_id);
CREATE TABLE publication.grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL REFERENCES knowledge.revisions,
 review_id uuid NOT NULL UNIQUE,
 revoked_at timestamptz,
 FOREIGN KEY(review_id,revision_id) REFERENCES publication.reviews(id,revision_id)
);
CREATE UNIQUE INDEX one_live_grant ON publication.grants(revision_id) WHERE revoked_at IS NULL;
CREATE TABLE publication.grant_languages (
 grant_id uuid NOT NULL REFERENCES publication.grants,
 language text NOT NULL REFERENCES knowledge.languages,
 PRIMARY KEY(grant_id,language)
);
CREATE TABLE publication.receipts (
 operation_id uuid PRIMARY KEY, actor name NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL
);
CREATE TABLE publication.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 operation_id uuid NOT NULL UNIQUE REFERENCES publication.receipts,
 actor name NOT NULL, action text NOT NULL,
 object_id uuid NOT NULL REFERENCES knowledge.objects,
 revision_id uuid,
 epoch bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(object_id,revision_id) REFERENCES knowledge.revisions(object_id,id)
);
CREATE TABLE publication.outbox (
 operation_id uuid PRIMARY KEY REFERENCES publication.receipts,
 object_id uuid NOT NULL REFERENCES knowledge.objects,
 generation bigint NOT NULL, epoch bigint NOT NULL
);
CREATE TABLE publication.page_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity_revision_id uuid NOT NULL REFERENCES knowledge.entities,
 entity_id uuid NOT NULL,
 language text NOT NULL REFERENCES knowledge.languages,
 reviewer name NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 4000),
 FOREIGN KEY(entity_id,entity_revision_id) REFERENCES knowledge.revisions(object_id,id),
 UNIQUE(entity_id,language,id)
);
CREATE TABLE publication.page_items (
 review_id uuid NOT NULL REFERENCES publication.page_reviews,
 position integer NOT NULL CHECK(position>0),
 block_revision_id uuid NOT NULL REFERENCES knowledge.blocks,
 PRIMARY KEY(review_id,position), UNIQUE(review_id,block_revision_id)
);
CREATE TABLE publication.page_review_dependencies (
 review_id uuid NOT NULL REFERENCES publication.page_reviews,
 revision_id uuid NOT NULL REFERENCES knowledge.revisions,
 generation bigint NOT NULL, PRIMARY KEY(review_id,revision_id)
);
CREATE TABLE publication.pages (
 entity_id uuid NOT NULL REFERENCES knowledge.objects,
 language text NOT NULL REFERENCES knowledge.languages,
 review_id uuid NOT NULL,
 generation bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(entity_id,language),
 FOREIGN KEY(entity_id,language,review_id) REFERENCES publication.page_reviews(entity_id,language,id)
);

CREATE FUNCTION knowledge.guard_child() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target_id uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.revision_id<>OLD.revision_id THEN RAISE EXCEPTION 'revision ownership is immutable'; END IF;
 IF TG_OP='DELETE' THEN target_id:=OLD.revision_id; ELSE target_id:=NEW.revision_id; END IF;
 PERFORM 1 FROM knowledge.revisions WHERE id=target_id AND state='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'frozen revision or missing draft'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['texts','entities','sources','assertions','evidence','attributions','blocks','block_references'] LOOP
  EXECUTE format('CREATE TRIGGER freeze_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.%I FOR EACH ROW EXECUTE FUNCTION knowledge.guard_child()',tbl);
 END LOOP;
END $$;
CREATE FUNCTION knowledge.guard_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.state='frozen' THEN RAISE EXCEPTION 'frozen revision'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'physical deletion is disabled'; END IF;
 IF (NEW.id,NEW.object_id,NEW.kind,NEW.variant,NEW.revision_no) IS DISTINCT FROM
    (OLD.id,OLD.object_id,OLD.kind,OLD.variant,OLD.revision_no) THEN RAISE EXCEPTION 'revision identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON knowledge.revisions FOR EACH ROW EXECUTE FUNCTION knowledge.guard_revision();

CREATE FUNCTION knowledge.closure(p_revision uuid) RETURNS TABLE(revision_id uuid)
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 WITH RECURSIVE deps(id) AS (
  SELECT target FROM knowledge.dependencies WHERE revision_id=p_revision
  UNION SELECT d.target FROM knowledge.dependencies d JOIN deps ON d.revision_id=deps.id
 ) SELECT id FROM deps
$$;
CREATE FUNCTION publication.require_actor(p_action text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM publication.principals WHERE db_role=session_user AND active
   AND CASE p_action WHEN 'review' THEN can_review WHEN 'publish' THEN can_publish ELSE false END)
 THEN RAISE EXCEPTION 'unauthorized actor'; END IF;
END $$;
CREATE FUNCTION publication.lock_control() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required'; END IF;
 PERFORM 1 FROM publication.control WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
END $$;
CREATE FUNCTION publication.usable(p_revision uuid,p_language text DEFAULT NULL) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM knowledge.revisions WHERE id=p_revision)
 AND NOT EXISTS(SELECT 1 FROM knowledge.closure(p_revision) WHERE revision_id=p_revision)
 AND NOT EXISTS (
  SELECT 1 FROM (SELECT p_revision AS revision_id UNION SELECT revision_id FROM knowledge.closure(p_revision)) dep
  LEFT JOIN knowledge.revisions r ON r.id=dep.revision_id
  LEFT JOIN knowledge.objects o ON o.id=r.object_id
  WHERE r.id IS NULL OR r.state<>'frozen' OR o.state<>'active' OR NOT EXISTS (
   SELECT 1 FROM publication.grants g JOIN publication.reviews v ON v.id=g.review_id AND v.revision_id=g.revision_id
   WHERE g.revision_id=r.id AND g.revoked_at IS NULL AND v.decision='approved'
    AND (r.id<>p_revision OR p_language IS NULL OR EXISTS (
     SELECT 1 FROM publication.grant_languages l WHERE l.grant_id=g.id AND l.language=p_language
    ))
  )
 )
$$;

CREATE FUNCTION api.create_draft(p_kind text,p_variant text,p_reason text,p_object uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE obj uuid; rev uuid; seq integer;
BEGIN
 obj:=p_object;
 IF obj IS NULL THEN INSERT INTO knowledge.objects(kind,variant) VALUES(p_kind,p_variant) RETURNING id INTO obj; END IF;
 PERFORM 1 FROM knowledge.objects WHERE id=obj AND kind=p_kind AND variant=p_variant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wrong object kind'; END IF;
 SELECT coalesce(max(revision_no),0)+1 INTO seq FROM knowledge.revisions WHERE object_id=obj;
 INSERT INTO knowledge.revisions(object_id,kind,variant,revision_no,reason) VALUES(obj,p_kind,p_variant,seq,p_reason) RETURNING id INTO rev;
 UPDATE knowledge.objects SET current_revision_id=rev WHERE id=obj;
 RETURN rev;
END $$;
CREATE FUNCTION api.put_text(p_revision uuid,p_language text,p_role text,p_content text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_role<>'alias' THEN DELETE FROM knowledge.texts WHERE revision_id=p_revision AND language=p_language AND role=p_role; END IF;
 INSERT INTO knowledge.texts(revision_id,language,role,content) VALUES(p_revision,p_language,p_role,p_content);
END $$;
CREATE FUNCTION api.put_entity(p_revision uuid,p_scope text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.entities(revision_id,identity_scope) VALUES(p_revision,p_scope)
 ON CONFLICT(revision_id) DO UPDATE SET identity_scope=excluded.identity_scope
$$;
CREATE FUNCTION api.put_source(p_revision uuid,p_citation text,p_language text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.sources(revision_id,citation,source_language) VALUES(p_revision,p_citation,p_language)
 ON CONFLICT(revision_id) DO UPDATE SET citation=excluded.citation,source_language=excluded.source_language
$$;
CREATE FUNCTION api.put_assertion(p_revision uuid,p_subject uuid,p_nature text,p_rationale text,p_target uuid DEFAULT NULL,p_predicate text DEFAULT NULL,p_predicate_version integer DEFAULT NULL)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.assertions(revision_id,subject_revision_id,nature,rationale,target_revision_id,predicate_code,predicate_version)
 VALUES(p_revision,p_subject,p_nature,p_rationale,p_target,p_predicate,p_predicate_version)
 ON CONFLICT(revision_id) DO UPDATE SET subject_revision_id=excluded.subject_revision_id,nature=excluded.nature,rationale=excluded.rationale,
 target_revision_id=excluded.target_revision_id,predicate_code=excluded.predicate_code,predicate_version=excluded.predicate_version
$$;
CREATE FUNCTION api.add_evidence(p_revision uuid,p_source uuid,p_role text,p_locator text,p_summary text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE eid uuid; BEGIN
 INSERT INTO knowledge.evidence(revision_id,source_revision_id,role,locator,summary) VALUES(p_revision,p_source,p_role,p_locator,p_summary) RETURNING id INTO eid; RETURN eid;
END $$;
CREATE FUNCTION api.add_attribution(p_revision uuid,p_evidence uuid,p_source uuid,p_speaker text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.attributions(revision_id,evidence_id,reporting_source_revision_id,speaker_label) VALUES(p_revision,p_evidence,p_source,p_speaker)
$$;
CREATE FUNCTION api.put_block(p_revision uuid,p_entity uuid,p_language text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE obj uuid; ent uuid;
BEGIN
 SELECT object_id INTO STRICT obj FROM knowledge.revisions WHERE id=p_revision AND kind='block';
 SELECT object_id INTO STRICT ent FROM knowledge.revisions WHERE id=p_entity AND kind='entity';
 INSERT INTO knowledge.block_identities(object_id,entity_id,language) VALUES(obj,ent,p_language) ON CONFLICT(object_id) DO NOTHING;
 INSERT INTO knowledge.blocks(revision_id,object_id,entity_id,entity_revision_id,language) VALUES(p_revision,obj,ent,p_entity,p_language)
 ON CONFLICT(revision_id) DO UPDATE SET entity_revision_id=excluded.entity_revision_id,language=excluded.language
 ,entity_id=excluded.entity_id;
END
$$;
CREATE FUNCTION api.add_block_reference(p_revision uuid,p_assertion uuid,p_start integer,p_end integer)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.block_references(revision_id,assertion_revision_id,start_cp,end_cp) VALUES(p_revision,p_assertion,p_start,p_end)
$$;
CREATE FUNCTION api.freeze(p_revision uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r knowledge.revisions; b knowledge.blocks;
BEGIN
 SELECT * INTO STRICT r FROM knowledge.revisions WHERE id=p_revision FOR UPDATE;
 IF r.state<>'draft' THEN RAISE EXCEPTION 'already frozen'; END IF;
 IF EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND NOT
   ((r.kind='entity' AND role IN ('preferred','alias')) OR (r.kind='source' AND role='title') OR
    (r.kind IN ('assertion','block') AND role='body'))) THEN RAISE EXCEPTION 'text role not allowed for this kind'; END IF;
 IF r.kind='entity' THEN
  IF NOT EXISTS(SELECT 1 FROM knowledge.entities WHERE revision_id=r.id) OR NOT EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND role='preferred')
  THEN RAISE EXCEPTION 'entity incomplete'; END IF;
 ELSIF r.kind='source' THEN
  IF NOT EXISTS(SELECT 1 FROM knowledge.sources WHERE revision_id=r.id) OR NOT EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND role='title')
  THEN RAISE EXCEPTION 'source incomplete'; END IF;
 ELSIF r.kind='assertion' THEN
  IF NOT EXISTS(SELECT 1 FROM knowledge.assertions WHERE revision_id=r.id AND ((r.variant='claim' AND target_revision_id IS NULL) OR
     (r.variant='relationship' AND target_revision_id IS NOT NULL AND nature='editorial' AND predicate_code='related_to_question')))
   OR NOT EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND role='body')
   OR NOT EXISTS(SELECT 1 FROM knowledge.evidence WHERE revision_id=r.id AND role='supports')
  THEN RAISE EXCEPTION 'assertion incomplete'; END IF;
  IF EXISTS(SELECT 1 FROM knowledge.assertions WHERE revision_id=r.id AND nature='position') AND NOT EXISTS(SELECT 1 FROM knowledge.attributions WHERE revision_id=r.id)
  THEN RAISE EXCEPTION 'position requires attribution'; END IF;
  IF r.variant='relationship' AND NOT EXISTS(SELECT 1 FROM knowledge.assertions a JOIN knowledge.revisions t ON t.id=a.target_revision_id WHERE a.revision_id=r.id AND t.variant='question')
  THEN RAISE EXCEPTION 'predicate target must be a question'; END IF;
 ELSE
  SELECT * INTO STRICT b FROM knowledge.blocks WHERE revision_id=r.id;
  IF NOT EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND language=b.language AND role='body')
   OR NOT EXISTS(SELECT 1 FROM knowledge.block_references WHERE revision_id=r.id)
   OR EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND language<>b.language)
   OR EXISTS(SELECT 1 FROM knowledge.block_references br WHERE br.revision_id=r.id AND br.end_cp>
     (SELECT length(content) FROM knowledge.texts WHERE revision_id=r.id AND role='body' AND language=b.language))
  THEN RAISE EXCEPTION 'block incomplete or invalid range'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM knowledge.closure(r.id) WHERE revision_id=r.id) THEN RAISE EXCEPTION 'dependency cycle'; END IF;
 IF EXISTS(SELECT 1 FROM knowledge.closure(r.id) d JOIN knowledge.revisions x ON x.id=d.revision_id WHERE x.state<>'frozen')
 THEN RAISE EXCEPTION 'dependency must be frozen'; END IF;
 UPDATE knowledge.revisions SET state='frozen',frozen_at=clock_timestamp() WHERE id=r.id;
END $$;

CREATE FUNCTION api.review(p_revision uuid,p_languages text[],p_decision text,p_reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE rid uuid; role_needed text;
BEGIN
 PERFORM publication.require_actor('review');
 SELECT CASE kind WHEN 'entity' THEN 'preferred' WHEN 'source' THEN 'title' ELSE 'body' END INTO role_needed FROM knowledge.revisions WHERE id=p_revision AND state='frozen';
 IF NOT FOUND OR coalesce(cardinality(p_languages),0)=0 OR array_position(p_languages,NULL) IS NOT NULL THEN RAISE EXCEPTION 'frozen revision and languages required'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_languages) l WHERE NOT EXISTS(SELECT 1 FROM knowledge.texts t WHERE t.revision_id=p_revision AND t.language=l AND t.role=role_needed))
 THEN RAISE EXCEPTION 'language text missing'; END IF;
 INSERT INTO publication.reviews(revision_id,decision,reviewer,reason) VALUES(p_revision,p_decision,session_user,p_reason) RETURNING id INTO rid;
 INSERT INTO publication.review_languages SELECT rid,l FROM unnest(p_languages) l;
 INSERT INTO publication.review_dependencies SELECT rid,d.revision_id,o.generation FROM knowledge.closure(p_revision) d JOIN knowledge.revisions r ON r.id=d.revision_id JOIN knowledge.objects o ON o.id=r.object_id;
 RETURN rid;
END $$;
CREATE FUNCTION publication.previous(p_op uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE receipt publication.receipts;
BEGIN
 SELECT * INTO receipt FROM publication.receipts WHERE operation_id=p_op;
 IF FOUND THEN
  IF receipt.payload<>p_payload OR receipt.actor<>session_user THEN RAISE EXCEPTION 'operation id reused with different input or actor'; END IF;
  RETURN receipt.result;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION publication.finish(p_op uuid,p_payload jsonb,p_result jsonb,p_action text,p_object uuid,p_revision uuid,p_generation bigint)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE e bigint; BEGIN
 UPDATE publication.control SET epoch=epoch+1 WHERE singleton RETURNING epoch INTO e;
 INSERT INTO publication.receipts VALUES(p_op,session_user,p_payload,p_result);
 INSERT INTO publication.audit(operation_id,actor,action,object_id,revision_id,epoch) VALUES(p_op,session_user,p_action,p_object,p_revision,e);
 INSERT INTO publication.outbox VALUES(p_op,p_object,p_generation,e);
 RETURN p_result;
END $$;
CREATE FUNCTION api.publish(p_revision uuid,p_review uuid,p_expected_generation bigint,p_operation uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r knowledge.revisions; o knowledge.objects; gid uuid; payload jsonb; previous jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 payload:=jsonb_build_array('publish',p_revision,p_review,p_expected_generation);
 previous:=publication.previous(p_operation,payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 SELECT * INTO STRICT r FROM knowledge.revisions WHERE id=p_revision;
 SELECT * INTO STRICT o FROM knowledge.objects WHERE id=r.object_id;
 IF p_expected_generation IS NULL OR o.generation<>p_expected_generation THEN RAISE EXCEPTION 'generation conflict'; END IF;
 IF o.state<>'active' OR r.state<>'frozen' THEN RAISE EXCEPTION 'target unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.reviews WHERE id=p_review AND revision_id=r.id AND decision='approved') THEN RAISE EXCEPTION 'approved review required'; END IF;
 IF EXISTS(SELECT 1 FROM publication.review_dependencies d JOIN knowledge.revisions x ON x.id=d.revision_id JOIN knowledge.objects root ON root.id=x.object_id
   WHERE d.review_id=p_review AND d.generation<>root.generation) THEN RAISE EXCEPTION 'review dependencies changed'; END IF;
 IF EXISTS(SELECT 1 FROM knowledge.closure(r.id) d WHERE NOT publication.usable(d.revision_id)) THEN RAISE EXCEPTION 'dependency unavailable'; END IF;
 INSERT INTO publication.grants(revision_id,review_id) VALUES(r.id,p_review) RETURNING id INTO gid;
 INSERT INTO publication.grant_languages SELECT gid,language FROM publication.review_languages WHERE review_id=p_review;
 UPDATE knowledge.objects SET published_revision_id=r.id,generation=generation+1 WHERE id=o.id;
 RETURN publication.finish(p_operation,payload,jsonb_build_object('grant_id',gid,'generation',o.generation+1),'publish',o.id,r.id,o.generation+1);
END $$;
CREATE FUNCTION api.revoke(p_revision uuid,p_expected_generation bigint,p_operation uuid,p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r knowledge.revisions; o knowledge.objects; payload jsonb; previous jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'reason required'; END IF;
 payload:=jsonb_build_array('revoke',p_revision,p_expected_generation,p_reason);
 previous:=publication.previous(p_operation,payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 SELECT * INTO STRICT r FROM knowledge.revisions WHERE id=p_revision;
 SELECT * INTO STRICT o FROM knowledge.objects WHERE id=r.object_id;
 IF p_expected_generation IS NULL OR o.generation<>p_expected_generation THEN RAISE EXCEPTION 'generation conflict'; END IF;
 UPDATE publication.grants SET revoked_at=clock_timestamp() WHERE revision_id=r.id AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'no active grant'; END IF;
 UPDATE knowledge.objects SET generation=generation+1 WHERE id=o.id;
 RETURN publication.finish(p_operation,payload,jsonb_build_object('revoked_revision_id',r.id,'generation',o.generation+1),'revoke',o.id,r.id,o.generation+1);
END $$;
CREATE FUNCTION api.suspend(p_object uuid,p_expected_generation bigint,p_operation uuid,p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o knowledge.objects; payload jsonb; previous jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'reason required'; END IF;
 payload:=jsonb_build_array('suspend',p_object,p_expected_generation,p_reason);
 previous:=publication.previous(p_operation,payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 SELECT * INTO STRICT o FROM knowledge.objects WHERE id=p_object;
 IF p_expected_generation IS NULL OR o.generation<>p_expected_generation THEN RAISE EXCEPTION 'generation conflict'; END IF;
 UPDATE knowledge.objects SET state='suspended',generation=generation+1 WHERE id=o.id;
 RETURN publication.finish(p_operation,payload,jsonb_build_object('suspended_object_id',o.id,'generation',o.generation+1),'suspend',o.id,NULL,o.generation+1);
END $$;

CREATE FUNCTION api.review_page(p_entity_revision uuid,p_language text,p_blocks uuid[],p_reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE rid uuid; eid uuid;
BEGIN
 PERFORM publication.require_actor('review');
 SELECT r.object_id INTO eid FROM knowledge.entities e JOIN knowledge.revisions r ON r.id=e.revision_id WHERE e.revision_id=p_entity_revision;
 IF eid IS NULL OR coalesce(cardinality(p_blocks),0)=0 OR array_position(p_blocks,NULL) IS NOT NULL THEN RAISE EXCEPTION 'page bundle required'; END IF;
 IF NOT publication.usable(p_entity_revision,p_language) OR EXISTS(SELECT 1 FROM unnest(p_blocks) v WHERE NOT publication.usable(v,p_language)
  OR NOT EXISTS(SELECT 1 FROM knowledge.blocks b WHERE b.revision_id=v AND b.entity_revision_id=p_entity_revision AND b.language=p_language))
 THEN RAISE EXCEPTION 'page bundle unavailable or wrong ownership'; END IF;
 INSERT INTO publication.page_reviews(entity_revision_id,entity_id,language,reviewer,reason) VALUES(p_entity_revision,eid,p_language,session_user,p_reason) RETURNING id INTO rid;
 INSERT INTO publication.page_items SELECT rid,n::integer,v FROM unnest(p_blocks) WITH ORDINALITY AS x(v,n);
 INSERT INTO publication.page_review_dependencies
 SELECT rid,d.rev,o.generation FROM (
  SELECT p_entity_revision AS rev UNION SELECT unnest(p_blocks)
  UNION SELECT c.revision_id FROM unnest(p_blocks) v CROSS JOIN LATERAL knowledge.closure(v) c
 ) d JOIN knowledge.revisions r ON r.id=d.rev JOIN knowledge.objects o ON o.id=r.object_id;
 RETURN rid;
END $$;
CREATE FUNCTION api.publish_page(p_review uuid,p_expected_generation bigint,p_operation uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE bundle publication.page_reviews; gen bigint; payload jsonb; previous jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 payload:=jsonb_build_array('publish_page',p_review,p_expected_generation);
 previous:=publication.previous(p_operation,payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 SELECT * INTO STRICT bundle FROM publication.page_reviews WHERE id=p_review;
 SELECT generation INTO gen FROM publication.pages WHERE entity_id=bundle.entity_id AND language=bundle.language;
 gen:=coalesce(gen,0);
 IF p_expected_generation IS NULL OR gen<>p_expected_generation THEN RAISE EXCEPTION 'generation conflict'; END IF;
 IF EXISTS(SELECT 1 FROM publication.page_review_dependencies d JOIN knowledge.revisions r ON r.id=d.revision_id JOIN knowledge.objects o ON o.id=r.object_id
  WHERE d.review_id=p_review AND (d.generation<>o.generation OR NOT publication.usable(r.id)))
 THEN RAISE EXCEPTION 'page review stale or unavailable'; END IF;
 INSERT INTO publication.pages VALUES(bundle.entity_id,bundle.language,p_review,gen+1)
 ON CONFLICT(entity_id,language) DO UPDATE SET review_id=excluded.review_id,generation=excluded.generation;
 RETURN publication.finish(p_operation,payload,jsonb_build_object('page_review_id',p_review,'generation',gen+1),'publish_page',bundle.entity_id,bundle.entity_revision_id,gen+1);
END $$;

-- Read functions are STABLE so access checks and returned fields share one snapshot.
CREATE FUNCTION api.read_revision(p_revision uuid,p_language text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 IF p_language IS NULL OR NOT publication.usable(p_revision,p_language) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('id',r.object_id,'revision_id',r.id,'revision_no',r.revision_no,'kind',r.kind,'language',p_language,
  'is_current',r.id=o.published_revision_id,
  'texts',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',t.role,'content',t.content) ORDER BY t.role,t.id),'[]') FROM knowledge.texts t WHERE t.revision_id=r.id AND t.language=p_language),
  'citation',(SELECT s.citation FROM knowledge.sources s WHERE s.revision_id=r.id),
  'assertion',(SELECT jsonb_build_object('subject_revision_id',a.subject_revision_id,'target_revision_id',a.target_revision_id,
   'nature',a.nature,'predicate',a.predicate_code,'predicate_version',a.predicate_version) FROM knowledge.assertions a WHERE a.revision_id=r.id),
  'attributions',(SELECT coalesce(jsonb_agg(jsonb_build_object('speaker',a.speaker_label,'evidence_id',a.evidence_id,
   'reporting_source_revision_id',a.reporting_source_revision_id) ORDER BY a.id),'[]') FROM knowledge.attributions a WHERE a.revision_id=r.id),
  'evidence',(SELECT coalesce(jsonb_agg(jsonb_build_object('source_revision_id',e.source_revision_id,'locator',e.locator,'role',e.role) ORDER BY e.id),'[]') FROM knowledge.evidence e WHERE e.revision_id=r.id))
 INTO result FROM knowledge.revisions r JOIN knowledge.objects o ON o.id=r.object_id WHERE r.id=p_revision;
 RETURN result;
END $$;
CREATE FUNCTION api.read_current(p_object uuid,p_language text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT api.read_revision((SELECT published_revision_id FROM knowledge.objects WHERE id=p_object),p_language)
$$;
CREATE FUNCTION api.read_page(p_entity uuid,p_language text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE bundle publication.page_reviews; title jsonb; items jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 SELECT r.* INTO bundle FROM publication.pages p JOIN publication.page_reviews r ON r.id=p.review_id WHERE p.entity_id=p_entity AND p.language=p_language;
 IF NOT FOUND THEN RETURN NULL; END IF;
 title:=api.read_revision(bundle.entity_revision_id,p_language);
 IF title IS NULL OR EXISTS(SELECT 1 FROM publication.page_items WHERE review_id=bundle.id AND NOT publication.usable(block_revision_id,p_language)) THEN RETURN NULL; END IF;
 SELECT jsonb_agg(api.read_revision(block_revision_id,p_language) ORDER BY position) INTO items FROM publication.page_items WHERE review_id=bundle.id;
 RETURN jsonb_build_object('entity',title,'blocks',items,'page_review_id',bundle.id);
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA knowledge,publication FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge,publication,api FROM PUBLIC;
GRANT USAGE ON SCHEMA api TO nm_editor,nm_reviewer,nm_publisher,nm_reader;
GRANT EXECUTE ON FUNCTION api.create_draft(text,text,text,uuid),api.put_text(uuid,text,text,text),api.put_entity(uuid,text),api.put_source(uuid,text,text),
 api.put_assertion(uuid,uuid,text,text,uuid,text,integer),api.add_evidence(uuid,uuid,text,text,text),api.add_attribution(uuid,uuid,uuid,text),
 api.put_block(uuid,uuid,text),api.add_block_reference(uuid,uuid,integer,integer),api.freeze(uuid) TO nm_editor;
GRANT EXECUTE ON FUNCTION api.review(uuid,text[],text,text),api.review_page(uuid,text,uuid[],text) TO nm_reviewer;
GRANT EXECUTE ON FUNCTION api.publish(uuid,uuid,bigint,uuid),api.revoke(uuid,bigint,uuid,text),api.suspend(uuid,bigint,uuid,text),api.publish_page(uuid,bigint,uuid) TO nm_publisher;
GRANT EXECUTE ON FUNCTION api.read_revision(uuid,text),api.read_current(uuid,text),api.read_page(uuid,text) TO nm_reader;
RESET ROLE;
GRANT USAGE ON SCHEMA knowledge,publication,api TO nm_read_owner;
GRANT SELECT ON knowledge.objects,knowledge.revisions,knowledge.texts,knowledge.sources,knowledge.dependencies,knowledge.assertions,knowledge.attributions,
 publication.control,publication.grants,publication.reviews,publication.grant_languages,knowledge.evidence,
 publication.pages,publication.page_reviews,publication.page_items TO nm_read_owner;
GRANT EXECUTE ON FUNCTION knowledge.closure(uuid),publication.usable(uuid,text),api.read_revision(uuid,text) TO nm_read_owner;
ALTER FUNCTION api.read_revision(uuid,text) OWNER TO nm_read_owner;
ALTER FUNCTION api.read_current(uuid,text) OWNER TO nm_read_owner;
ALTER FUNCTION api.read_page(uuid,text) OWNER TO nm_read_owner;
COMMIT;
