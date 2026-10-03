BEGIN;
SET ROLE nm_owner;
CREATE FUNCTION publication.require_inspector() RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM publication.principals WHERE db_role=session_user AND active AND (can_edit OR can_review OR can_publish)) THEN RAISE EXCEPTION 'unauthorized actor'; END IF;
END $$;
ALTER FUNCTION api.editor_list() SET SCHEMA publication;
ALTER FUNCTION api.editor_revision(uuid) SET SCHEMA publication;
REVOKE EXECUTE ON FUNCTION publication.editor_list(),publication.editor_revision(uuid) FROM nm_editor,nm_reviewer,nm_publisher;
CREATE FUNCTION api.editor_list() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM publication.require_inspector(); RETURN publication.editor_list(); END $$;
CREATE FUNCTION api.editor_revision(p_revision uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM publication.require_inspector(); RETURN publication.editor_revision(p_revision); END $$;
CREATE FUNCTION api.clone_revision(p_revision uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r knowledge.revisions; rev uuid; item record; new_evidence uuid; new_text uuid;
BEGIN
 PERFORM publication.require_actor('edit');
 SELECT * INTO STRICT r FROM knowledge.revisions WHERE id=p_revision AND state='frozen';
 rev:=api.create_draft(r.kind,r.variant,p_reason,r.object_id);
 FOR item IN SELECT * FROM knowledge.texts WHERE revision_id=r.id LOOP
  INSERT INTO knowledge.texts(revision_id,language,role,content) VALUES(rev,item.language,item.role,item.content) RETURNING id INTO new_text;
  INSERT INTO knowledge.translations(revision_id,object_id,text_id,source_text_id,reason)
   SELECT rev,r.object_id,new_text,source_text_id,reason FROM knowledge.translations WHERE text_id=item.id;
 END LOOP;
 IF r.kind='entity' THEN INSERT INTO knowledge.entities(revision_id,identity_scope) SELECT rev,identity_scope FROM knowledge.entities WHERE revision_id=r.id;
 ELSIF r.kind='source' THEN
  INSERT INTO knowledge.sources(revision_id,citation,source_language) SELECT rev,citation,source_language FROM knowledge.sources WHERE revision_id=r.id;
  INSERT INTO knowledge.source_metadata SELECT rev,work_revision_id,edition,publication_info,url FROM knowledge.source_metadata WHERE revision_id=r.id;
  INSERT INTO knowledge.source_credits(revision_id,role,label) SELECT rev,role,label FROM knowledge.source_credits WHERE revision_id=r.id;
 ELSIF r.kind='assertion' THEN
  INSERT INTO knowledge.assertions(revision_id,subject_revision_id,target_revision_id,nature,predicate_code,predicate_version,rationale)
   SELECT rev,subject_revision_id,target_revision_id,nature,predicate_code,predicate_version,rationale FROM knowledge.assertions WHERE revision_id=r.id;
  FOR item IN SELECT * FROM knowledge.evidence WHERE revision_id=r.id LOOP
   INSERT INTO knowledge.evidence(revision_id,source_revision_id,role,locator,summary) VALUES(rev,item.source_revision_id,item.role,item.locator,item.summary) RETURNING id INTO new_evidence;
   INSERT INTO knowledge.attributions(revision_id,evidence_id,reporting_source_revision_id,speaker_label,speaker_role,speaker_entity_revision_id,context)
    SELECT rev,new_evidence,reporting_source_revision_id,speaker_label,speaker_role,speaker_entity_revision_id,context FROM knowledge.attributions WHERE evidence_id=item.id;
  END LOOP;
  INSERT INTO knowledge.editorial_basis SELECT rev,assertion_revision_id,reason FROM knowledge.editorial_basis WHERE revision_id=r.id;
 ELSE
  INSERT INTO knowledge.blocks(revision_id,object_id,entity_id,entity_revision_id,language)
   SELECT rev,object_id,entity_id,entity_revision_id,language FROM knowledge.blocks WHERE revision_id=r.id;
  INSERT INTO knowledge.block_references(revision_id,assertion_revision_id,start_cp,end_cp)
   SELECT rev,assertion_revision_id,start_cp,end_cp FROM knowledge.block_references WHERE revision_id=r.id;
 END IF;
 RETURN rev;
END $$;
CREATE FUNCTION api.editor_page(p_entity uuid,p_language text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM publication.require_inspector();
 RETURN jsonb_build_object('generation',coalesce((SELECT generation FROM publication.pages WHERE entity_id=p_entity AND language=p_language),0),
 'blocks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.revision_id,'text',t.content,'published',publication.usable(b.revision_id,p_language))),'[]')
  FROM knowledge.blocks b JOIN knowledge.revisions r ON r.id=b.revision_id JOIN knowledge.texts t ON t.revision_id=b.revision_id AND t.language=b.language AND t.role='body'
  WHERE b.entity_id=p_entity AND b.language=p_language AND r.state='frozen'));
END $$;
CREATE FUNCTION api.replace_block_references(p_revision uuid,p_assertions uuid[],p_end integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM publication.require_actor('edit');
 PERFORM 1 FROM knowledge.revisions WHERE id=p_revision AND kind='block' AND state='draft' FOR UPDATE;
 IF NOT FOUND OR coalesce(cardinality(p_assertions),0)=0 OR cardinality(p_assertions)>30 OR array_position(p_assertions,NULL) IS NOT NULL THEN RAISE EXCEPTION 'draft block and references required'; END IF;
 DELETE FROM knowledge.block_references WHERE revision_id=p_revision;
 INSERT INTO knowledge.block_references(revision_id,assertion_revision_id,start_cp,end_cp) SELECT p_revision,a,0,p_end FROM unnest(p_assertions) a;
END $$;
CREATE FUNCTION api.release_page(p_entity_revision uuid,p_language text,p_blocks uuid[],p_expected_generation bigint,p_operation uuid,p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE request_payload jsonb; previous jsonb; reviewed uuid; result jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('review'); PERFORM publication.require_actor('publish');
 request_payload:=jsonb_build_array('release_page',p_entity_revision,p_language,p_blocks,p_expected_generation,p_reason);
 previous:=publication.previous(p_operation,request_payload); IF previous IS NOT NULL THEN RETURN previous; END IF;
 reviewed:=api.review_page(p_entity_revision,p_language,p_blocks,p_reason);
 result:=api.publish_page(reviewed,p_expected_generation,p_operation);
 -- This remains in the same transaction: the receipt identifies the user's bundle request.
 UPDATE publication.receipts SET payload=request_payload WHERE operation_id=p_operation;
 RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION api.clone_revision(uuid,text) TO nm_editor;
GRANT EXECUTE ON FUNCTION api.replace_block_references(uuid,uuid[],integer) TO nm_editor;
GRANT EXECUTE ON FUNCTION api.editor_list(),api.editor_revision(uuid),api.editor_page(uuid,text) TO nm_editor,nm_reviewer,nm_publisher;
GRANT EXECUTE ON FUNCTION api.release_page(uuid,text,uuid[],bigint,uuid,text) TO nm_reviewer,nm_publisher;
RESET ROLE;
COMMIT;
