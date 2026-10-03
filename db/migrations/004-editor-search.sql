BEGIN;
SET ROLE nm_owner;
CREATE INDEX source_metadata_work ON knowledge.source_metadata(work_revision_id);
CREATE INDEX block_entity_language ON knowledge.blocks(entity_id,language);
CREATE INDEX revisions_created ON knowledge.revisions(created_at DESC,id);
CREATE FUNCTION api.editor_search(p_query text,p_kind text,p_state text,p_offset integer DEFAULT 0) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE total bigint; items jsonb;
BEGIN
 PERFORM publication.require_inspector();
 IF p_query IS NULL OR length(p_query)>200 OR p_offset IS NULL OR p_offset<0 OR p_offset>1000000
  OR (p_kind IS NOT NULL AND p_kind NOT IN('entity','source','assertion','block'))
  OR (p_state IS NOT NULL AND p_state NOT IN('draft','frozen')) THEN RAISE EXCEPTION 'invalid search'; END IF;
 SELECT count(*) INTO total FROM knowledge.revisions r
 WHERE (p_kind IS NULL OR r.kind=p_kind) AND (p_state IS NULL OR r.state=p_state)
 AND (p_query='' OR EXISTS(SELECT 1 FROM knowledge.texts t WHERE t.revision_id=r.id AND t.language='ja' AND strpos(t.content,p_query)>0));
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO items FROM (
  SELECT r.id,r.object_id,r.kind,r.variant,r.revision_no,r.state,r.created_at,o.state AS object_state,o.generation,
   publication.usable(r.id,'ja') AS published,
   (SELECT left(split_part(t.content,E'\n',1),100) FROM knowledge.texts t WHERE t.revision_id=r.id AND t.language='ja' AND t.role IN('preferred','title','body') ORDER BY t.role LIMIT 1) AS title
  FROM knowledge.revisions r JOIN knowledge.objects o ON o.id=r.object_id
  WHERE (p_kind IS NULL OR r.kind=p_kind) AND (p_state IS NULL OR r.state=p_state)
   AND (p_query='' OR EXISTS(SELECT 1 FROM knowledge.texts t WHERE t.revision_id=r.id AND t.language='ja' AND strpos(t.content,p_query)>0))
  ORDER BY r.created_at DESC,r.id LIMIT 100 OFFSET p_offset
 ) x;
 RETURN jsonb_build_object('items',items,'total',total);
END $$;
CREATE OR REPLACE FUNCTION api.editor_list() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT api.editor_search('',NULL,NULL,0)->'items'
$$;
-- Page candidates have stable ordering. Pagination of large bundles is a later UI step.
CREATE OR REPLACE FUNCTION api.editor_page(p_entity uuid,p_language text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM publication.require_inspector();
 RETURN jsonb_build_object('generation',coalesce((SELECT generation FROM publication.pages WHERE entity_id=p_entity AND language=p_language),0),
 'blocks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.revision_id,'text',t.content,'published',publication.usable(b.revision_id,p_language)) ORDER BY r.created_at,b.revision_id),'[]')
  FROM knowledge.blocks b JOIN knowledge.revisions r ON r.id=b.revision_id JOIN knowledge.texts t ON t.revision_id=b.revision_id AND t.language=b.language AND t.role='body'
  WHERE b.entity_id=p_entity AND b.language=p_language AND r.state='frozen'));
END $$;
GRANT EXECUTE ON FUNCTION api.editor_search(text,text,text,integer) TO nm_editor,nm_reviewer,nm_publisher;
RESET ROLE;
COMMIT;
