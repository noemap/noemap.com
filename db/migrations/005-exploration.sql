-- Exploration uses the existing stable entity IDs and reviewed page bundles.
BEGIN;
SET ROLE nm_owner;

CREATE TABLE knowledge.node_types (
 code text PRIMARY KEY CHECK(code IN ('question','person','concept','work')),
 collection text NOT NULL UNIQUE,
 label_ja text NOT NULL,
 CHECK(collection IN ('questions','people','concepts','books'))
);
INSERT INTO knowledge.node_types VALUES
 ('question','questions','問い'),('person','people','人物'),
 ('concept','concepts','概念'),('work','books','著作');
CREATE TABLE publication.node_routes (
 entity_id uuid NOT NULL,
 kind text NOT NULL DEFAULT 'entity' CHECK(kind='entity'),
 type text NOT NULL REFERENCES knowledge.node_types(code),
 language text NOT NULL REFERENCES knowledge.languages(tag),
 slug text NOT NULL CHECK(length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  AND slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 canonical boolean NOT NULL,
 created_by name NOT NULL DEFAULT session_user,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(type,language,slug),
 FOREIGN KEY(entity_id,kind,type) REFERENCES knowledge.objects(id,kind,variant)
);
CREATE UNIQUE INDEX node_route_canonical ON publication.node_routes(entity_id,language) WHERE canonical;
CREATE INDEX node_route_entity ON publication.node_routes(entity_id,language);
CREATE TABLE publication.home (
 language text PRIMARY KEY REFERENCES knowledge.languages(tag),
 root_id uuid NOT NULL REFERENCES knowledge.objects(id),
 configured_by name NOT NULL,
 configured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE publication.home_entries (
 language text NOT NULL REFERENCES publication.home(language),
 position integer NOT NULL CHECK(position BETWEEN 1 AND 32),
 entity_id uuid NOT NULL REFERENCES knowledge.objects(id),
 PRIMARY KEY(language,position), UNIQUE(language,entity_id)
);

-- This helper has no elevated privileges. Only server projection owners may call it.
CREATE FUNCTION publication.node_summary(p_entity uuid,p_language text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE bundle publication.page_reviews; node_type text; title text; description text; route text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 IF p_language IS NULL THEN RETURN NULL; END IF;
 SELECT r.* INTO bundle
 FROM publication.pages p JOIN publication.page_reviews r ON r.id=p.review_id
 JOIN knowledge.objects o ON o.id=p.entity_id
 WHERE p.entity_id=p_entity AND p.language=p_language AND o.kind='entity'
  AND r.entity_revision_id=o.published_revision_id;
 IF NOT FOUND OR NOT publication.usable(bundle.entity_revision_id,p_language) THEN RETURN NULL; END IF;
 SELECT variant INTO node_type FROM knowledge.objects WHERE id=p_entity;
 IF NOT EXISTS(SELECT 1 FROM publication.page_items WHERE review_id=bundle.id)
  OR EXISTS(SELECT 1 FROM publication.page_items WHERE review_id=bundle.id AND NOT publication.usable(block_revision_id,p_language))
  OR EXISTS(SELECT 1 FROM publication.page_items i JOIN knowledge.block_references ref ON ref.revision_id=i.block_revision_id
   WHERE i.review_id=bundle.id AND NOT publication.usable(ref.assertion_revision_id,p_language)) THEN RETURN NULL; END IF;
 SELECT content INTO title FROM knowledge.texts WHERE revision_id=bundle.entity_revision_id AND language=p_language AND role='preferred';
 IF title IS NULL THEN RETURN NULL; END IF;
 SELECT left(CASE WHEN strpos(t.content,E'\n')>0 THEN split_part(t.content,E'\n',2) ELSE t.content END,280)
 INTO description FROM publication.page_items i JOIN knowledge.texts t ON t.revision_id=i.block_revision_id
 WHERE i.review_id=bundle.id AND t.language=p_language AND t.role='body' ORDER BY i.position LIMIT 1;
 SELECT '/'||nt.collection||'/'||coalesce(nr.slug,p_entity::text) INTO route
 FROM knowledge.node_types nt LEFT JOIN publication.node_routes nr
  ON nr.type=nt.code AND nr.entity_id=p_entity AND nr.language=p_language AND nr.canonical
 WHERE nt.code=node_type;
 RETURN jsonb_build_object('id',p_entity,'revision_id',bundle.entity_revision_id,'type',node_type,'title',title,
  'aliases',(SELECT coalesce(jsonb_agg(content ORDER BY content,id),'[]') FROM knowledge.texts
   WHERE revision_id=bundle.entity_revision_id AND language=p_language AND role='alias'),
  'href',route,'summary',coalesce(description,''));
END $$;

CREATE FUNCTION api.set_node_route(p_entity uuid,p_language text,p_slug text,p_reason text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE node jsonb; node_type text; result jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'reason required'; END IF;
 IF p_slug IS NULL OR length(p_slug) NOT BETWEEN 1 AND 80 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  OR p_slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'invalid node slug'; END IF;
 node:=publication.node_summary(p_entity,p_language);
 IF node IS NULL THEN RAISE EXCEPTION 'published navigable entity required'; END IF;
 node_type:=node->>'type';
 IF EXISTS(SELECT 1 FROM publication.node_routes WHERE type=node_type AND language=p_language AND slug=p_slug AND entity_id<>p_entity)
 THEN RAISE EXCEPTION 'slug already reserved'; END IF;
 UPDATE publication.node_routes SET canonical=false WHERE entity_id=p_entity AND language=p_language AND canonical;
 INSERT INTO publication.node_routes(entity_id,type,language,slug,canonical) VALUES(p_entity,node_type,p_language,p_slug,true)
 ON CONFLICT(type,language,slug) DO UPDATE SET canonical=true;
 result:=jsonb_build_object('id',p_entity,'href',publication.node_summary(p_entity,p_language)->>'href');
 RETURN publication.finish(gen_random_uuid(),jsonb_build_array('set_node_route',p_entity,p_language,p_slug,p_reason),result,
  'set_node_route',p_entity,(node->>'revision_id')::uuid,(SELECT generation FROM knowledge.objects WHERE id=p_entity));
END $$;

CREATE FUNCTION api.set_home(p_root uuid,p_entries uuid[],p_reason text,p_language text DEFAULT 'ja') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE root_node jsonb; result jsonb;
BEGIN
 PERFORM publication.lock_control(); PERFORM publication.require_actor('publish');
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'reason required'; END IF;
 IF p_entries IS NULL OR cardinality(p_entries)>32 OR coalesce(array_ndims(p_entries),1)<>1
  OR array_position(p_entries,NULL) IS NOT NULL OR p_root=ANY(p_entries)
  OR cardinality(p_entries)<>(SELECT count(DISTINCT id) FROM unnest(p_entries) id)
 THEN RAISE EXCEPTION 'invalid home entries'; END IF;
 root_node:=publication.node_summary(p_root,p_language);
 IF root_node IS NULL OR root_node->>'type'<>'question' OR EXISTS(
  SELECT 1 FROM unnest(p_entries) id WHERE publication.node_summary(id,p_language) IS NULL
   OR publication.node_summary(id,p_language)->>'type'<>'question'
 ) THEN RAISE EXCEPTION 'published navigable questions required'; END IF;
 INSERT INTO publication.home(language,root_id,configured_by) VALUES(p_language,p_root,session_user)
 ON CONFLICT(language) DO UPDATE SET root_id=EXCLUDED.root_id,configured_by=EXCLUDED.configured_by,configured_at=clock_timestamp();
 DELETE FROM publication.home_entries WHERE language=p_language;
 INSERT INTO publication.home_entries(language,position,entity_id) SELECT p_language,n::integer,id FROM unnest(p_entries) WITH ORDINALITY x(id,n);
 result:=jsonb_build_object('root_id',p_root,'entries',to_jsonb(p_entries));
 RETURN publication.finish(gen_random_uuid(),jsonb_build_array('set_home',p_root,p_entries,p_reason,p_language),result,
  'set_home',p_root,(root_node->>'revision_id')::uuid,(SELECT generation FROM knowledge.objects WHERE id=p_root));
END $$;

CREATE FUNCTION api.public_node(p_entity uuid,p_language text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE node jsonb; page jsonb; bundle uuid;
BEGIN
 node:=publication.node_summary(p_entity,p_language); IF node IS NULL THEN RETURN NULL; END IF;
 page:=api.read_page(p_entity,p_language); bundle:=(page->>'page_review_id')::uuid;
 RETURN node||jsonb_build_object('article',page||jsonb_build_object(
  'sections',(SELECT jsonb_agg(jsonb_build_object('revision_id',i.block_revision_id,
   'text',(SELECT content FROM knowledge.texts WHERE revision_id=i.block_revision_id AND language=p_language AND role='body'),
   'assertions',(SELECT coalesce(jsonb_agg(api.read_evidence(ref.assertion_revision_id,p_language) ORDER BY ref.id),'[]')
    FROM knowledge.block_references ref WHERE ref.revision_id=i.block_revision_id)) ORDER BY i.position)
   FROM publication.page_items i WHERE i.review_id=bundle),'connections','[]'::jsonb));
END $$;

CREATE FUNCTION api.public_neighbors(p_entity uuid,p_language text,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE node jsonb; items jsonb; more boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 40 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
 THEN RAISE EXCEPTION 'invalid neighbor page'; END IF;
 node:=publication.node_summary(p_entity,p_language);
 IF node IS NULL THEN RETURN jsonb_build_object('items','[]'::jsonb,'offset',p_offset,'has_more',false); END IF;
 WITH candidates AS MATERIALIZED (
  SELECT a.revision_id AS id,
   CASE WHEN a.subject_revision_id=(node->>'revision_id')::uuid THEN 'outgoing' ELSE 'incoming' END AS direction,
   CASE WHEN a.subject_revision_id=(node->>'revision_id')::uuid THEN '関連する問い' ELSE 'この問いに関連する知識' END AS label,
   a.rationale AS reason,
   publication.node_summary(other.object_id,p_language) AS neighbor,
   CASE WHEN a.subject_revision_id=(node->>'revision_id')::uuid THEN a.target_revision_id ELSE a.subject_revision_id END AS other_revision
  FROM knowledge.assertions a JOIN knowledge.revisions ar ON ar.id=a.revision_id
  JOIN knowledge.objects ao ON ao.id=ar.object_id AND ao.published_revision_id=ar.id
  JOIN knowledge.revisions other ON other.id=CASE WHEN a.subject_revision_id=(node->>'revision_id')::uuid THEN a.target_revision_id ELSE a.subject_revision_id END
  WHERE ar.variant='relationship' AND a.predicate_code='related_to_question' AND a.predicate_version=1
   AND (a.subject_revision_id=(node->>'revision_id')::uuid OR a.target_revision_id=(node->>'revision_id')::uuid)
   AND publication.usable(a.revision_id,p_language)
 ), slice AS MATERIALIZED (
  SELECT * FROM candidates WHERE neighbor IS NOT NULL AND (neighbor->>'revision_id')::uuid=other_revision
  ORDER BY id LIMIT p_limit+1 OFFSET p_offset
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'direction',direction,'label',label,'reason',reason,'node',neighbor) ORDER BY id)
  FILTER(WHERE position<=p_limit),'[]'),coalesce(bool_or(position>p_limit),false)
 INTO items,more FROM (SELECT *,row_number() OVER(ORDER BY id) AS position FROM slice) x;
 RETURN jsonb_build_object('items',items,'offset',p_offset,'has_more',more);
END $$;

CREATE FUNCTION api.public_search(p_query text,p_language text,p_type text DEFAULT NULL,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE items jsonb; more boolean; query text;
BEGIN
 IF p_query IS NULL OR length(p_query)>200 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 40
  OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
  OR (p_type IS NOT NULL AND p_type NOT IN('question','person','concept','work')) THEN RAISE EXCEPTION 'invalid public search'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 query:=lower(btrim(normalize(p_query,NFKC)));
 WITH matches AS MATERIALIZED (
  SELECT o.id,min(CASE WHEN lower(normalize(t.content,NFKC))=query AND t.role='preferred' THEN 0
    WHEN lower(normalize(t.content,NFKC))=query THEN 1 WHEN starts_with(lower(normalize(t.content,NFKC)),query) THEN 2 ELSE 3 END) AS rank
  FROM publication.pages p JOIN publication.page_reviews pr ON pr.id=p.review_id
  JOIN knowledge.objects o ON o.id=p.entity_id AND o.published_revision_id=pr.entity_revision_id
  JOIN knowledge.texts t ON t.revision_id=o.published_revision_id AND t.language=p_language AND t.role IN('preferred','alias')
  WHERE p.language=p_language AND (p_type IS NULL OR o.variant=p_type) AND (query='' OR strpos(lower(normalize(t.content,NFKC)),query)>0)
  GROUP BY o.id
 ), eligible AS MATERIALIZED (
  SELECT id,rank,publication.node_summary(id,p_language) AS node FROM matches
 ), slice AS MATERIALIZED (
  SELECT * FROM eligible WHERE node IS NOT NULL ORDER BY rank,node->>'title',id LIMIT p_limit+1 OFFSET p_offset
 )
 SELECT coalesce(jsonb_agg(node ORDER BY rank,node->>'title',id) FILTER(WHERE position<=p_limit),'[]'),coalesce(bool_or(position>p_limit),false)
 INTO items,more FROM (SELECT *,row_number() OVER(ORDER BY rank,node->>'title',id) AS position FROM slice) x;
 RETURN jsonb_build_object('items',items,'offset',p_offset,'has_more',more);
END $$;

CREATE FUNCTION api.resolve_node(p_collection text,p_key text,p_language text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE entity uuid; node_type text; node jsonb;
BEGIN
 IF p_collection IS NULL OR p_key IS NULL OR length(p_key)>80 THEN RETURN NULL; END IF;
 SELECT code INTO node_type FROM knowledge.node_types WHERE collection=p_collection;
 IF node_type IS NULL THEN RETURN NULL; END IF;
 IF p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN entity:=p_key::uuid;
 ELSE SELECT entity_id INTO entity FROM publication.node_routes WHERE type=node_type AND language=p_language AND slug=p_key; END IF;
 node:=publication.node_summary(entity,p_language);
 IF node IS NULL OR node->>'type'<>node_type THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',entity,'href',node->>'href','redirect',node->>'href'<>'/'||p_collection||'/'||p_key);
END $$;

CREATE FUNCTION api.public_home(p_language text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE root_node jsonb; questions jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'fresh READ COMMITTED read required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication.control WHERE singleton) THEN RAISE EXCEPTION 'publication control unavailable'; END IF;
 SELECT publication.node_summary(root_id,p_language) INTO root_node FROM publication.home WHERE language=p_language;
 SELECT coalesce(jsonb_agg(node ORDER BY position),'[]') INTO questions FROM (
  SELECT position,publication.node_summary(entity_id,p_language) AS node FROM publication.home_entries WHERE language=p_language
 ) x WHERE node IS NOT NULL;
 RETURN jsonb_build_object('root',root_node,'questions',questions);
END $$;

GRANT EXECUTE ON FUNCTION api.set_node_route(uuid,text,text,text),api.set_home(uuid,uuid[],text,text) TO nm_publisher;
RESET ROLE;
GRANT SELECT ON knowledge.node_types,publication.node_routes,publication.home,publication.home_entries TO nm_read_owner;
GRANT EXECUTE ON FUNCTION publication.node_summary(uuid,text) TO nm_read_owner;
GRANT EXECUTE ON FUNCTION api.public_node(uuid,text),api.public_neighbors(uuid,text,integer,integer),
 api.public_search(text,text,text,integer,integer),api.resolve_node(text,text,text),api.public_home(text) TO nm_reader;
ALTER FUNCTION api.public_node(uuid,text) OWNER TO nm_read_owner;
ALTER FUNCTION api.public_neighbors(uuid,text,integer,integer) OWNER TO nm_read_owner;
ALTER FUNCTION api.public_search(text,text,text,integer,integer) OWNER TO nm_read_owner;
ALTER FUNCTION api.resolve_node(text,text,text) OWNER TO nm_read_owner;
ALTER FUNCTION api.public_home(text) OWNER TO nm_read_owner;
COMMIT;
