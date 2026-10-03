-- Additive migration. Apply after 001 with applications stopped for the migration.
BEGIN;
GRANT EXECUTE ON FUNCTION api.read_revision(uuid,text),api.read_page(uuid,text) TO nm_owner;
SET ROLE nm_owner;
SELECT 1 FROM publication.control WHERE singleton FOR UPDATE;
ALTER TABLE publication.principals ADD COLUMN can_edit boolean NOT NULL DEFAULT false;
ALTER TABLE publication.reviews ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE knowledge.objects ADD COLUMN state_changed_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE FUNCTION knowledge.track_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state THEN NEW.state_changed_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER state_time BEFORE UPDATE ON knowledge.objects FOR EACH ROW EXECUTE FUNCTION knowledge.track_state();

-- Backfill belongs to this locked schema migration, not the editorial API.
ALTER TABLE knowledge.texts ADD COLUMN object_id uuid;
ALTER TABLE knowledge.texts DISABLE TRIGGER freeze_guard;
UPDATE knowledge.texts t SET object_id=r.object_id FROM knowledge.revisions r WHERE r.id=t.revision_id;
ALTER TABLE knowledge.texts ENABLE TRIGGER freeze_guard;
ALTER TABLE knowledge.texts ALTER COLUMN object_id SET NOT NULL;
ALTER TABLE knowledge.texts ADD FOREIGN KEY(object_id,revision_id) REFERENCES knowledge.revisions(object_id,id);
ALTER TABLE knowledge.texts ADD UNIQUE(id,object_id);
ALTER TABLE knowledge.texts ADD UNIQUE(id,revision_id,object_id);
CREATE FUNCTION knowledge.text_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 SELECT object_id INTO NEW.object_id FROM knowledge.revisions WHERE id=NEW.revision_id;
 RETURN NEW;
END $$;
CREATE TRIGGER a_text_owner BEFORE INSERT OR UPDATE ON knowledge.texts FOR EACH ROW EXECUTE FUNCTION knowledge.text_owner();
CREATE TABLE knowledge.translations (
 revision_id uuid NOT NULL REFERENCES knowledge.revisions,
 object_id uuid NOT NULL,
 text_id uuid PRIMARY KEY,
 source_text_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 CHECK(text_id<>source_text_id),
 FOREIGN KEY(text_id,revision_id,object_id) REFERENCES knowledge.texts(id,revision_id,object_id),
 FOREIGN KEY(source_text_id,object_id) REFERENCES knowledge.texts(id,object_id)
);
CREATE INDEX translations_source ON knowledge.translations(source_text_id);
CREATE INDEX translations_revision ON knowledge.translations(revision_id);
CREATE TRIGGER freeze_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.translations FOR EACH ROW EXECUTE FUNCTION knowledge.guard_child();
CREATE TABLE knowledge.editorial_basis (
 revision_id uuid NOT NULL REFERENCES knowledge.assertions,
 assertion_revision_id uuid NOT NULL REFERENCES knowledge.assertions,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 4000),
 PRIMARY KEY(revision_id,assertion_revision_id), CHECK(revision_id<>assertion_revision_id)
);
CREATE INDEX editorial_basis_target ON knowledge.editorial_basis(assertion_revision_id);
CREATE TRIGGER freeze_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.editorial_basis FOR EACH ROW EXECUTE FUNCTION knowledge.guard_child();
ALTER TABLE knowledge.attributions ADD COLUMN speaker_role text NOT NULL DEFAULT 'original_statement'
 CHECK(speaker_role IN ('original_statement','quoted_person','reported_position','editor_note','hypothesis'));
ALTER TABLE knowledge.attributions ADD COLUMN speaker_entity_revision_id uuid REFERENCES knowledge.entities;
ALTER TABLE knowledge.attributions ADD COLUMN context text NOT NULL DEFAULT '' CHECK(length(context)<=4000);
CREATE INDEX attribution_speaker ON knowledge.attributions(speaker_entity_revision_id);
CREATE TABLE knowledge.source_metadata (
 revision_id uuid PRIMARY KEY REFERENCES knowledge.sources,
 work_revision_id uuid REFERENCES knowledge.entities,
 edition text NOT NULL CHECK(length(btrim(edition)) BETWEEN 1 AND 2000),
 publication_info text NOT NULL CHECK(length(publication_info)<=2000),
 url text CHECK(url IS NULL OR (length(url)<=2000 AND url ~ '^https?://'))
);
CREATE TABLE knowledge.source_credits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id uuid NOT NULL REFERENCES knowledge.sources,
 role text NOT NULL CHECK(role IN ('author','editor','translator','publisher')),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 1000)
);
CREATE INDEX source_credits_revision ON knowledge.source_credits(revision_id);
CREATE TRIGGER freeze_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.source_metadata FOR EACH ROW EXECUTE FUNCTION knowledge.guard_child();
CREATE TRIGGER freeze_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.source_credits FOR EACH ROW EXECUTE FUNCTION knowledge.guard_child();
CREATE OR REPLACE VIEW knowledge.dependencies AS
 SELECT revision_id,subject_revision_id AS target FROM knowledge.assertions
 UNION SELECT revision_id,target_revision_id FROM knowledge.assertions WHERE target_revision_id IS NOT NULL
 UNION SELECT revision_id,source_revision_id FROM knowledge.evidence
 UNION SELECT revision_id,entity_revision_id FROM knowledge.blocks
 UNION SELECT revision_id,assertion_revision_id FROM knowledge.block_references
 UNION SELECT revision_id,assertion_revision_id FROM knowledge.editorial_basis
 UNION SELECT revision_id,speaker_entity_revision_id FROM knowledge.attributions WHERE speaker_entity_revision_id IS NOT NULL
 UNION SELECT t.revision_id,s.revision_id FROM knowledge.translations t JOIN knowledge.texts s ON s.id=t.source_text_id WHERE t.revision_id<>s.revision_id
 UNION SELECT revision_id,work_revision_id FROM knowledge.source_metadata WHERE work_revision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION publication.require_actor(p_action text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM publication.principals WHERE db_role=session_user AND active
   AND CASE p_action WHEN 'edit' THEN can_edit WHEN 'review' THEN can_review WHEN 'publish' THEN can_publish ELSE false END)
 THEN RAISE EXCEPTION 'unauthorized actor'; END IF;
END $$;
CREATE OR REPLACE FUNCTION knowledge.guard_child() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target_id uuid;
BEGIN
 PERFORM publication.require_actor('edit');
 IF TG_OP='UPDATE' AND NEW.revision_id<>OLD.revision_id THEN RAISE EXCEPTION 'revision ownership is immutable'; END IF;
 IF TG_OP='DELETE' THEN target_id:=OLD.revision_id; ELSE target_id:=NEW.revision_id; END IF;
 PERFORM 1 FROM knowledge.revisions WHERE id=target_id AND state='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'frozen revision or missing draft'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE OR REPLACE FUNCTION api.create_draft(p_kind text,p_variant text,p_reason text,p_object uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE obj uuid; rev uuid; seq integer;
BEGIN
 PERFORM publication.require_actor('edit'); obj:=p_object;
 IF obj IS NULL THEN INSERT INTO knowledge.objects(kind,variant) VALUES(p_kind,p_variant) RETURNING id INTO obj; END IF;
 PERFORM 1 FROM knowledge.objects WHERE id=obj AND kind=p_kind AND variant=p_variant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wrong object kind'; END IF;
 SELECT coalesce(max(revision_no),0)+1 INTO seq FROM knowledge.revisions WHERE object_id=obj;
 INSERT INTO knowledge.revisions(object_id,kind,variant,revision_no,reason) VALUES(obj,p_kind,p_variant,seq,p_reason) RETURNING id INTO rev;
 UPDATE knowledge.objects SET current_revision_id=rev WHERE id=obj;
 RETURN rev;
END $$;
CREATE FUNCTION api.add_editorial_basis(p_revision uuid,p_basis uuid,p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.editorial_basis VALUES(p_revision,p_basis,p_reason)
$$;
CREATE FUNCTION api.add_translation(p_text uuid,p_source_text uuid,p_reason text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.translations(revision_id,object_id,text_id,source_text_id,reason)
 SELECT revision_id,object_id,p_text,p_source_text,p_reason FROM knowledge.texts WHERE id=p_text
$$;
CREATE FUNCTION api.attribute(p_revision uuid,p_evidence uuid,p_source uuid,p_speaker text,p_role text,p_context text,p_entity uuid DEFAULT NULL)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.attributions(revision_id,evidence_id,reporting_source_revision_id,speaker_label,speaker_role,context,speaker_entity_revision_id)
 VALUES(p_revision,p_evidence,p_source,p_speaker,p_role,p_context,p_entity)
$$;
CREATE FUNCTION api.source_metadata(p_revision uuid,p_edition text,p_info text,p_url text DEFAULT NULL,p_work uuid DEFAULT NULL)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.source_metadata VALUES(p_revision,p_work,p_edition,p_info,p_url)
 ON CONFLICT(revision_id) DO UPDATE SET work_revision_id=excluded.work_revision_id,edition=excluded.edition,publication_info=excluded.publication_info,url=excluded.url
$$;
CREATE FUNCTION api.source_credit(p_revision uuid,p_role text,p_label text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO knowledge.source_credits(revision_id,role,label) VALUES(p_revision,p_role,p_label)
$$;
CREATE OR REPLACE FUNCTION api.freeze(p_revision uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r knowledge.revisions; b knowledge.blocks; a knowledge.assertions;
BEGIN
 PERFORM publication.require_actor('edit');
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
  IF EXISTS(SELECT 1 FROM knowledge.source_metadata m JOIN knowledge.revisions w ON w.id=m.work_revision_id WHERE m.revision_id=r.id AND w.variant<>'work')
  THEN RAISE EXCEPTION 'source work type mismatch'; END IF;
 ELSIF r.kind='assertion' THEN
  SELECT * INTO STRICT a FROM knowledge.assertions WHERE revision_id=r.id;
  IF NOT ((r.variant='claim' AND a.target_revision_id IS NULL) OR (r.variant='relationship' AND a.target_revision_id IS NOT NULL AND a.nature='editorial' AND a.predicate_code='related_to_question'))
   OR NOT EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND role='body') THEN RAISE EXCEPTION 'assertion incomplete'; END IF;
  IF a.nature='editorial' THEN
   IF NOT EXISTS(SELECT 1 FROM knowledge.editorial_basis WHERE revision_id=r.id) THEN RAISE EXCEPTION 'editorial basis required'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM knowledge.evidence WHERE revision_id=r.id AND role='supports') THEN RAISE EXCEPTION 'supporting evidence required'; END IF;
  IF a.nature='position' AND NOT EXISTS(SELECT 1 FROM knowledge.attributions WHERE revision_id=r.id) THEN RAISE EXCEPTION 'position requires attribution'; END IF;
  IF r.variant='relationship' AND NOT EXISTS(SELECT 1 FROM knowledge.revisions WHERE id=a.target_revision_id AND variant='question') THEN RAISE EXCEPTION 'predicate target must be a question'; END IF;
 ELSE
  SELECT * INTO STRICT b FROM knowledge.blocks WHERE revision_id=r.id;
  IF NOT EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND language=b.language AND role='body')
   OR NOT EXISTS(SELECT 1 FROM knowledge.block_references WHERE revision_id=r.id)
   OR EXISTS(SELECT 1 FROM knowledge.texts WHERE revision_id=r.id AND language<>b.language)
   OR EXISTS(SELECT 1 FROM knowledge.block_references br WHERE br.revision_id=r.id AND br.end_cp>
     (SELECT length(content) FROM knowledge.texts WHERE revision_id=r.id AND role='body' AND language=b.language)) THEN RAISE EXCEPTION 'block incomplete or invalid range'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM knowledge.translations t JOIN knowledge.texts dst ON dst.id=t.text_id JOIN knowledge.texts src ON src.id=t.source_text_id
  WHERE t.revision_id=r.id AND (dst.language=src.language OR dst.role<>src.role)) THEN RAISE EXCEPTION 'translation language or text role mismatch'; END IF;
 IF EXISTS(WITH RECURSIVE path(start_id,next_id) AS (
  SELECT text_id,source_text_id FROM knowledge.translations WHERE revision_id=r.id
  UNION SELECT p.start_id,t.source_text_id FROM path p JOIN knowledge.translations t ON t.text_id=p.next_id
 ) SELECT 1 FROM path WHERE start_id=next_id) THEN RAISE EXCEPTION 'translation cycle'; END IF;
 IF EXISTS(SELECT 1 FROM knowledge.closure(r.id) WHERE revision_id=r.id) THEN RAISE EXCEPTION 'dependency cycle'; END IF;
 IF EXISTS(SELECT 1 FROM knowledge.closure(r.id) d JOIN knowledge.revisions x ON x.id=d.revision_id WHERE x.state<>'frozen') THEN RAISE EXCEPTION 'dependency must be frozen'; END IF;
 UPDATE knowledge.revisions SET state='frozen',frozen_at=clock_timestamp() WHERE id=r.id;
END $$;

CREATE FUNCTION publication.valid_review() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM publication.reviews WHERE id=NEW.review_id AND revision_id=NEW.revision_id AND decision='approved' AND withdrawn_at IS NULL)
 THEN RAISE EXCEPTION 'approved current review required'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER review_guard BEFORE INSERT ON publication.grants FOR EACH ROW EXECUTE FUNCTION publication.valid_review();
CREATE OR REPLACE FUNCTION publication.usable(p_revision uuid,p_language text DEFAULT NULL) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM knowledge.revisions WHERE id=p_revision)
 AND NOT EXISTS(SELECT 1 FROM knowledge.closure(p_revision) WHERE revision_id=p_revision)
 AND NOT EXISTS (
  SELECT 1 FROM (SELECT p_revision AS revision_id UNION SELECT revision_id FROM knowledge.closure(p_revision)) dep
  LEFT JOIN knowledge.revisions r ON r.id=dep.revision_id LEFT JOIN knowledge.objects o ON o.id=r.object_id
  WHERE r.id IS NULL OR r.state<>'frozen' OR o.state<>'active' OR NOT EXISTS (
   SELECT 1 FROM publication.grants g JOIN publication.reviews v ON v.id=g.review_id AND v.revision_id=g.revision_id
   WHERE g.revision_id=r.id AND g.revoked_at IS NULL AND v.decision='approved' AND v.withdrawn_at IS NULL
    AND (r.id<>p_revision OR p_language IS NULL OR EXISTS(SELECT 1 FROM publication.grant_languages l WHERE l.grant_id=g.id AND l.language=p_language))
  )
 )
$$;
CREATE FUNCTION api.withdraw_review(p_review uuid,p_expected_generation bigint,p_operation uuid,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v publication.reviews; r knowledge.revisions; o knowledge.objects; payload jsonb; previous jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('review');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'reason required'; END IF;
 payload:=jsonb_build_array('withdraw_review',p_review,p_expected_generation,p_reason);
 previous:=publication.previous(p_operation,payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 SELECT * INTO STRICT v FROM publication.reviews WHERE id=p_review;
 SELECT * INTO STRICT r FROM knowledge.revisions WHERE id=v.revision_id;
 SELECT * INTO STRICT o FROM knowledge.objects WHERE id=r.object_id;
 IF p_expected_generation IS NULL OR o.generation<>p_expected_generation THEN RAISE EXCEPTION 'generation conflict'; END IF;
 IF v.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'review already withdrawn'; END IF;
 UPDATE publication.reviews SET withdrawn_at=clock_timestamp() WHERE id=v.id;
 UPDATE publication.grants SET revoked_at=clock_timestamp() WHERE review_id=v.id AND revoked_at IS NULL;
 UPDATE knowledge.objects SET generation=generation+1 WHERE id=o.id;
 RETURN publication.finish(p_operation,payload,jsonb_build_object('withdrawn_review_id',v.id,'generation',o.generation+1),'withdraw_review',o.id,r.id,o.generation+1);
END $$;
CREATE FUNCTION api.resume(p_object uuid,p_reviews uuid[],p_expected_generation bigint,p_operation uuid,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o knowledge.objects; v publication.reviews; rid uuid; last_revision uuid; gid uuid; ids uuid[]:='{}'; payload jsonb; previous jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'reason required'; END IF;
 payload:=jsonb_build_array('resume',p_object,p_reviews,p_expected_generation,p_reason);
 previous:=publication.previous(p_operation,payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 SELECT * INTO STRICT o FROM knowledge.objects WHERE id=p_object;
 IF p_expected_generation IS NULL OR o.generation<>p_expected_generation THEN RAISE EXCEPTION 'generation conflict'; END IF;
 IF o.state<>'suspended' THEN RAISE EXCEPTION 'object is not suspended'; END IF;
 IF coalesce(cardinality(p_reviews),0)=0 OR array_position(p_reviews,NULL) IS NOT NULL THEN RAISE EXCEPTION 'new reviews required'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_reviews) x GROUP BY x HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate review'; END IF;
 FOREACH rid IN ARRAY p_reviews LOOP
  SELECT * INTO STRICT v FROM publication.reviews WHERE id=rid;
  IF v.decision<>'approved' OR v.withdrawn_at IS NOT NULL OR v.created_at<=o.state_changed_at
   OR NOT EXISTS(SELECT 1 FROM knowledge.revisions WHERE id=v.revision_id AND object_id=o.id AND state='frozen') THEN RAISE EXCEPTION 'new reviewed version required'; END IF;
  IF EXISTS(SELECT 1 FROM publication.review_dependencies d JOIN knowledge.revisions r ON r.id=d.revision_id JOIN knowledge.objects x ON x.id=r.object_id WHERE d.review_id=rid AND d.generation<>x.generation)
  THEN RAISE EXCEPTION 'review dependencies changed'; END IF;
 END LOOP;
 UPDATE publication.grants SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND revision_id IN(SELECT id FROM knowledge.revisions WHERE object_id=o.id);
 FOREACH rid IN ARRAY p_reviews LOOP
  SELECT * INTO v FROM publication.reviews WHERE id=rid;
  INSERT INTO publication.grants(revision_id,review_id) VALUES(v.revision_id,v.id) RETURNING id INTO gid;
  INSERT INTO publication.grant_languages SELECT gid,language FROM publication.review_languages WHERE review_id=rid;
  ids:=array_append(ids,gid); last_revision:=v.revision_id;
 END LOOP;
 UPDATE knowledge.objects SET state='active',generation=generation+1,published_revision_id=last_revision WHERE id=o.id;
 FOREACH rid IN ARRAY p_reviews LOOP
  IF NOT publication.usable((SELECT revision_id FROM publication.reviews WHERE id=rid)) THEN RAISE EXCEPTION 'dependency unavailable'; END IF;
 END LOOP;
 RETURN publication.finish(p_operation,payload,jsonb_build_object('grant_ids',ids,'generation',o.generation+1),'resume',o.id,last_revision,o.generation+1);
END $$;

-- Authorized editors receive drafts through a fixed projection, never table grants.
CREATE FUNCTION api.editor_list() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_agg(row_to_json(x)),'[]') FROM (
  SELECT r.id,r.object_id,r.kind,r.variant,r.revision_no,r.state,o.state AS object_state,o.generation,
   (SELECT content FROM knowledge.texts WHERE revision_id=r.id AND language='ja' AND role IN('preferred','title','body') ORDER BY role LIMIT 1) AS title
  FROM knowledge.revisions r JOIN knowledge.objects o ON o.id=r.object_id ORDER BY r.created_at DESC,r.id LIMIT 100
 ) x
$$;
CREATE FUNCTION api.editor_revision(p_revision uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('revision',to_jsonb(r),'generation',o.generation,'object_state',o.state,
 'texts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.language,t.role),'[]') FROM knowledge.texts t WHERE t.revision_id=r.id),
 'entity',(SELECT to_jsonb(e) FROM knowledge.entities e WHERE e.revision_id=r.id),
 'source',(SELECT to_jsonb(s) FROM knowledge.sources s WHERE s.revision_id=r.id),
 'source_metadata',(SELECT to_jsonb(m) FROM knowledge.source_metadata m WHERE m.revision_id=r.id),
 'source_credits',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM knowledge.source_credits c WHERE c.revision_id=r.id),
 'assertion',(SELECT to_jsonb(a) FROM knowledge.assertions a WHERE a.revision_id=r.id),
 'block',(SELECT to_jsonb(b) FROM knowledge.blocks b WHERE b.revision_id=r.id),
 'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM knowledge.evidence e WHERE e.revision_id=r.id),
 'attributions',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') FROM knowledge.attributions a WHERE a.revision_id=r.id),
 'basis',(SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]') FROM knowledge.editorial_basis b WHERE b.revision_id=r.id),
 'translations',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM knowledge.translations t WHERE t.revision_id=r.id),
 'references',(SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]') FROM knowledge.block_references b WHERE b.revision_id=r.id),
 'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('languages',(SELECT array_agg(language) FROM publication.review_languages WHERE review_id=v.id),'used',EXISTS(SELECT 1 FROM publication.grants WHERE review_id=v.id)) ORDER BY v.created_at DESC),'[]') FROM publication.reviews v WHERE v.revision_id=r.id))
 FROM knowledge.revisions r JOIN knowledge.objects o ON o.id=r.object_id WHERE r.id=p_revision
$$;
CREATE FUNCTION api.read_evidence(p_revision uuid,p_language text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 result:=api.read_revision(p_revision,p_language); IF result IS NULL THEN RETURN NULL; END IF;
 RETURN result || jsonb_build_object('sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('source_revision_id',e.source_revision_id,'citation',s.citation,'locator',e.locator,'role',e.role,
  'edition',m.edition,'url',m.url) ORDER BY e.id),'[]') FROM knowledge.evidence e JOIN knowledge.sources s ON s.revision_id=e.source_revision_id LEFT JOIN knowledge.source_metadata m ON m.revision_id=s.revision_id WHERE e.revision_id=p_revision),
 'basis',(SELECT coalesce(jsonb_agg(b.assertion_revision_id),'[]') FROM knowledge.editorial_basis b WHERE b.revision_id=p_revision),
 'attributions',(SELECT coalesce(jsonb_agg(jsonb_build_object('speaker',a.speaker_label,'role',a.speaker_role,'context',a.context,'source_revision_id',a.reporting_source_revision_id)),'[]') FROM knowledge.attributions a WHERE a.revision_id=p_revision));
END $$;
CREATE FUNCTION api.read_article(p_entity uuid,p_language text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE page jsonb; bundle uuid;
BEGIN
 page:=api.read_page(p_entity,p_language); IF page IS NULL THEN RETURN NULL; END IF;
 bundle:=(page->>'page_review_id')::uuid;
 IF EXISTS(SELECT 1 FROM publication.page_items i JOIN knowledge.block_references ref ON ref.revision_id=i.block_revision_id
  WHERE i.review_id=bundle AND NOT publication.usable(ref.assertion_revision_id,p_language)) THEN RETURN NULL; END IF;
 RETURN page || jsonb_build_object('sections',(SELECT jsonb_agg(jsonb_build_object('revision_id',i.block_revision_id,'text',(SELECT content FROM knowledge.texts WHERE revision_id=i.block_revision_id AND language=p_language AND role='body'),
  'assertions',(SELECT coalesce(jsonb_agg(api.read_evidence(ref.assertion_revision_id,p_language)),'[]') FROM knowledge.block_references ref WHERE ref.revision_id=i.block_revision_id)) ORDER BY i.position)
  FROM publication.page_items i WHERE i.review_id=bundle),
 'connections',(SELECT coalesce(jsonb_agg(jsonb_build_object('revision_id',a.revision_id,'subject',(SELECT content FROM knowledge.texts WHERE revision_id=a.subject_revision_id AND language=p_language AND role='preferred'),
 'subject_revision_id',a.subject_revision_id,'target_revision_id',a.target_revision_id,'label','問いに関連する')),'[]') FROM knowledge.assertions a
 WHERE a.target_revision_id=(page->'entity'->>'revision_id')::uuid AND a.predicate_code='related_to_question' AND publication.usable(a.revision_id,p_language) AND publication.usable(a.subject_revision_id,p_language)));
END $$;
CREATE FUNCTION api.public_catalog(p_language text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_agg(row_to_json(x)),'[]') FROM (
  SELECT p.entity_id AS id,r.entity_revision_id AS revision_id,
   (SELECT content FROM knowledge.texts WHERE revision_id=r.entity_revision_id AND language=p_language AND role='preferred') AS title,
   (SELECT count(*)::integer FROM publication.page_items WHERE review_id=r.id) AS sections
  FROM publication.pages p JOIN publication.page_reviews r ON r.id=p.review_id
  WHERE p.language=p_language AND api.read_article(p.entity_id,p_language) IS NOT NULL
  ORDER BY p.entity_id LIMIT 24
 ) x
$$;

GRANT EXECUTE ON FUNCTION api.add_editorial_basis(uuid,uuid,text),api.add_translation(uuid,uuid,text),api.attribute(uuid,uuid,uuid,text,text,text,uuid),
 api.source_metadata(uuid,text,text,text,uuid),api.source_credit(uuid,text,text) TO nm_editor;
GRANT EXECUTE ON FUNCTION api.withdraw_review(uuid,bigint,uuid,text) TO nm_reviewer;
GRANT EXECUTE ON FUNCTION api.resume(uuid,uuid[],bigint,uuid,text) TO nm_publisher;
GRANT EXECUTE ON FUNCTION api.editor_list(),api.editor_revision(uuid) TO nm_editor,nm_reviewer,nm_publisher;
GRANT EXECUTE ON FUNCTION api.read_evidence(uuid,text),api.read_article(uuid,text),api.public_catalog(text) TO nm_reader,nm_read_owner;
RESET ROLE;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA knowledge,publication,api FROM PUBLIC;
GRANT SELECT ON knowledge.block_references,knowledge.editorial_basis,knowledge.source_metadata TO nm_read_owner;
ALTER FUNCTION api.read_evidence(uuid,text) OWNER TO nm_read_owner;
ALTER FUNCTION api.read_article(uuid,text) OWNER TO nm_read_owner;
ALTER FUNCTION api.public_catalog(text) OWNER TO nm_read_owner;
COMMIT;
