-- Chronology is a typed, sourced claim, not an unsourced field on a node.
-- Differing dates are independent assertion objects; corrections are new revisions.
BEGIN;
SET ROLE nm_owner;

CREATE TABLE knowledge.temporal_statements (
  revision_id uuid PRIMARY KEY REFERENCES knowledge.assertions(revision_id),
  role text NOT NULL CHECK (role IN ('birth','death','active','publication','founding')),
  original_label text NOT NULL CHECK (length(btrim(original_label)) BETWEEN 1 AND 2000),
  date_label text NOT NULL CHECK (length(btrim(date_label)) BETWEEN 1 AND 1000),
  calendar text NOT NULL CHECK (length(btrim(calendar)) BETWEEN 1 AND 120),
  normalization text NOT NULL CHECK (normalization='astronomical_year'),
  precision text NOT NULL DEFAULT 'year' CHECK (precision='year'),
  -- PostgreSQL integers reject nonfinite values and overflow. Do not impose an
  -- arbitrary historical cutoff that would exclude prehistoric human origins.
  start_earliest integer,
  start_latest integer,
  end_earliest integer,
  end_latest integer,
  CHECK (start_earliest IS NULL OR start_latest IS NULL OR start_earliest<=start_latest),
  CHECK (end_earliest IS NULL OR end_latest IS NULL OR end_earliest<=end_latest),
  -- Overlapping uncertain ranges are valid; reject only impossible ordering.
  CHECK (start_earliest IS NULL OR end_latest IS NULL OR start_earliest<=end_latest),
  CHECK (role='active' OR (end_earliest IS NULL AND end_latest IS NULL))
);
CREATE INDEX temporal_start ON knowledge.temporal_statements
  ((coalesce(start_earliest,start_latest,end_earliest,end_latest)),revision_id);

CREATE FUNCTION knowledge.validate_temporal(p_revision uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE item knowledge.temporal_statements; a knowledge.assertions; variant text; subject_type text;
BEGIN
 SELECT * INTO item FROM knowledge.temporal_statements WHERE revision_id=p_revision;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO STRICT a FROM knowledge.assertions WHERE revision_id=p_revision;
 SELECT r.variant,s.variant INTO variant,subject_type FROM knowledge.revisions r
  JOIN knowledge.revisions s ON s.id=a.subject_revision_id WHERE r.id=p_revision;
 IF variant<>'claim' OR a.target_revision_id IS NOT NULL OR a.nature NOT IN ('fact_report','interpretation')
 THEN RAISE EXCEPTION 'temporal statement requires a fact-report or interpretation claim'; END IF;
 IF (item.role IN ('birth','death') AND subject_type<>'person') OR
    (item.role='publication' AND subject_type<>'work') OR
    (item.role='active' AND subject_type NOT IN ('person','work','concept')) OR
    (item.role='founding' AND subject_type<>'concept')
 THEN RAISE EXCEPTION 'temporal role and subject type mismatch'; END IF;
END $$;

CREATE FUNCTION knowledge.temporal_shape() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM knowledge.validate_temporal(NEW.revision_id);
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge.temporal_statements
 FOR EACH ROW EXECUTE FUNCTION knowledge.guard_child();
-- AFTER observes the inserted row. The revision lock above prevents a racing freeze.
CREATE TRIGGER temporal_shape AFTER INSERT OR UPDATE ON knowledge.temporal_statements
 FOR EACH ROW EXECUTE FUNCTION knowledge.temporal_shape();

CREATE FUNCTION knowledge.freeze_temporal() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.state='frozen' AND OLD.state='draft' THEN
  PERFORM knowledge.validate_temporal(NEW.id);
  IF EXISTS(SELECT 1 FROM knowledge.temporal_statements WHERE revision_id=NEW.id) AND
     NOT EXISTS(SELECT 1 FROM knowledge.evidence WHERE revision_id=NEW.id AND role='supports')
  THEN RAISE EXCEPTION 'temporal statement requires supporting evidence'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER temporal_validation BEFORE UPDATE OF state ON knowledge.revisions
 FOR EACH ROW EXECUTE FUNCTION knowledge.freeze_temporal();

CREATE FUNCTION api.put_temporal(p_revision uuid,p_role text,p_original_label text,p_date_label text,
 p_calendar text,p_normalization text,p_start_earliest integer,p_start_latest integer,
 p_end_earliest integer DEFAULT NULL,p_end_latest integer DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM publication.require_actor('edit');
 INSERT INTO knowledge.temporal_statements(revision_id,role,original_label,date_label,calendar,normalization,
  start_earliest,start_latest,end_earliest,end_latest)
 VALUES(p_revision,p_role,p_original_label,p_date_label,p_calendar,p_normalization,
  p_start_earliest,p_start_latest,p_end_earliest,p_end_latest)
 ON CONFLICT(revision_id) DO UPDATE SET role=excluded.role,original_label=excluded.original_label,
  date_label=excluded.date_label,calendar=excluded.calendar,normalization=excluded.normalization,
  start_earliest=excluded.start_earliest,start_latest=excluded.start_latest,
  end_earliest=excluded.end_earliest,end_latest=excluded.end_latest;
END $$;

-- Keep the existing clone implementation and copy the new typed child as well.
ALTER FUNCTION api.clone_revision(uuid,text) SET SCHEMA publication;
ALTER FUNCTION publication.clone_revision(uuid,text) RENAME TO clone_base_revision;
REVOKE ALL ON FUNCTION publication.clone_base_revision(uuid,text) FROM nm_editor,nm_reviewer,nm_publisher,nm_reader;
CREATE FUNCTION api.clone_revision(p_revision uuid,p_reason text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE rev uuid;
BEGIN
 PERFORM publication.require_actor('edit');
 rev:=publication.clone_base_revision(p_revision,p_reason);
 INSERT INTO knowledge.temporal_statements(revision_id,role,original_label,date_label,calendar,normalization,
  precision,start_earliest,start_latest,end_earliest,end_latest)
 SELECT rev,role,original_label,date_label,calendar,normalization,precision,
  start_earliest,start_latest,end_earliest,end_latest FROM knowledge.temporal_statements WHERE revision_id=p_revision;
 RETURN rev;
END $$;

-- Reviewers inspect the same typed bounds and labels that the public APIs use.
-- The base projection remains private as established by migration 003.
CREATE OR REPLACE FUNCTION api.editor_revision(p_revision uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM publication.require_inspector();
 result:=publication.editor_revision(p_revision);
 IF result IS NULL THEN RETURN NULL; END IF;
 RETURN result||jsonb_build_object('temporal',(SELECT to_jsonb(t) FROM knowledge.temporal_statements t WHERE revision_id=p_revision));
END $$;

-- A chronology requires the currently selected assertion and the exact selected
-- subject revision. Every dependency must be visible in the requested language.
CREATE FUNCTION publication.timeline_rows(p_language text,p_entity uuid DEFAULT NULL)
 RETURNS TABLE(date_record jsonb,sort_year integer,date_id uuid)
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',t.revision_id,'node',n.summary,'role',t.role,
  'date_label',t.date_label,'original_label',t.original_label,'calendar',t.calendar,
  'normalization',t.normalization,'precision',t.precision,
  'start_earliest',t.start_earliest,'start_latest',t.start_latest,
  'end_earliest',t.end_earliest,'end_latest',t.end_latest),
  coalesce(t.start_earliest,t.start_latest,t.end_earliest,t.end_latest),t.revision_id
 FROM knowledge.temporal_statements t JOIN knowledge.assertions a ON a.revision_id=t.revision_id
 JOIN knowledge.revisions r ON r.id=t.revision_id
 JOIN knowledge.objects o ON o.id=r.object_id AND o.published_revision_id=r.id
 JOIN knowledge.revisions s ON s.id=a.subject_revision_id
 CROSS JOIN LATERAL (SELECT publication.node_summary(s.object_id,p_language) AS summary) n
 WHERE (p_entity IS NULL OR s.object_id=p_entity) AND n.summary IS NOT NULL
  AND (n.summary->>'revision_id')::uuid=a.subject_revision_id
  AND publication.usable(t.revision_id,p_language)
  AND NOT EXISTS(SELECT 1 FROM knowledge.closure(t.revision_id) dep
   WHERE NOT publication.usable(dep.revision_id,p_language))
$$;

CREATE FUNCTION api.public_timeline(p_language text DEFAULT 'ja',p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 IF p_language IS NULL OR p_language NOT IN ('ja','en') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
  OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid timeline bounds'; END IF;
 WITH selected AS MATERIALIZED (
  SELECT date_record,sort_year,date_id FROM publication.timeline_rows(p_language)
  ORDER BY sort_year NULLS LAST,date_id LIMIT p_limit+1 OFFSET p_offset
 ), displayed AS (SELECT * FROM selected ORDER BY sort_year NULLS LAST,date_id LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(date_record ORDER BY sort_year NULLS LAST,date_id) FROM displayed),'[]'),
  'offset',p_offset,'has_more',(SELECT count(*)>p_limit FROM selected)) INTO result;
 RETURN result;
END $$;

CREATE FUNCTION api.public_dates(p_entity uuid,p_language text DEFAULT 'ja') RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 IF p_entity IS NULL OR p_language IS NULL OR p_language NOT IN ('ja','en') THEN RETURN '[]'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(date_record ORDER BY sort_year NULLS LAST,date_id),'[]') FROM
  (SELECT * FROM publication.timeline_rows(p_language,p_entity) ORDER BY sort_year NULLS LAST,date_id LIMIT 50) selected);
END $$;

GRANT EXECUTE ON FUNCTION api.put_temporal(uuid,text,text,text,text,text,integer,integer,integer,integer),api.clone_revision(uuid,text) TO nm_editor;
GRANT EXECUTE ON FUNCTION api.public_timeline(text,integer,integer),api.public_dates(uuid,text) TO nm_reader,nm_read_owner;
GRANT EXECUTE ON FUNCTION publication.timeline_rows(text,uuid) TO nm_read_owner;
RESET ROLE;
REVOKE ALL ON knowledge.temporal_statements FROM PUBLIC;
REVOKE ALL ON FUNCTION knowledge.validate_temporal(uuid),knowledge.temporal_shape(),knowledge.freeze_temporal(),
 publication.timeline_rows(text,uuid),publication.clone_base_revision(uuid,text),
 api.put_temporal(uuid,text,text,text,text,text,integer,integer,integer,integer),api.clone_revision(uuid,text),
 api.public_timeline(text,integer,integer),api.public_dates(uuid,text) FROM PUBLIC;
GRANT SELECT ON knowledge.temporal_statements TO nm_read_owner;
ALTER FUNCTION api.public_timeline(text,integer,integer) OWNER TO nm_read_owner;
ALTER FUNCTION api.public_dates(uuid,text) OWNER TO nm_read_owner;
COMMIT;
