-- Separate storage for the source-backed, explicitly provisional public release.
-- No legacy human-review approval is created or bypassed. No user is enrolled.
create schema noemap_private;
revoke all on schema noemap_private from public;

create table noemap_private.editors (
  user_id uuid primary key references auth.users(id),
  label text not null check (length(label) between 1 and 100),
  enabled boolean not null default true
);
create table noemap_private.snapshots (
  id uuid primary key default gen_random_uuid(),
  document jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  actor_label text not null,
  reason text not null check (length(reason) between 1 and 1000),
  check (octet_length(document::text) <= 2000000)
);
create table noemap_private.state (
  id boolean primary key default true check (id),
  generation bigint not null default 0 check (generation between 0 and 9007199254740991),
  current_snapshot_id uuid not null references noemap_private.snapshots(id),
  draft_snapshot_id uuid references noemap_private.snapshots(id)
);
create table noemap_private.operations (
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  request jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);
create table public.noemap_public_release (
  id boolean primary key default true check (id),
  generation bigint not null check (generation between 0 and 9007199254740991),
  snapshot_id uuid not null references noemap_private.snapshots(id),
  document jsonb not null,
  updated_at timestamptz not null default now()
);
create index noemap_snapshots_created_at on noemap_private.snapshots(created_at desc,id desc);
create index noemap_snapshots_created_by on noemap_private.snapshots(created_by);
alter table noemap_private.editors enable row level security;
alter table noemap_private.snapshots enable row level security;
alter table noemap_private.state enable row level security;
alter table noemap_private.operations enable row level security;
alter table public.noemap_public_release enable row level security;
revoke all on all tables in schema noemap_private from public, anon, authenticated;
revoke all on public.noemap_public_release from public, anon, authenticated;
grant select on public.noemap_public_release to anon, authenticated;
create policy noemap_public_read on public.noemap_public_release for select to anon, authenticated using (true);

-- Pure helpers use no privileged database reads.
create function noemap_private.object_uuid(p_key text) returns uuid
language sql immutable strict set search_path = '' as $$
  with bytes as (select sha256(convert_to('noemap/provisional/' || p_key, 'UTF8')) b),
  adjusted as (select set_byte(set_byte(b, 6, (get_byte(b,6) & 15) | 64),8,(get_byte(b,8) & 63) | 128) b from bytes)
  select encode(substring(b from 1 for 16),'hex')::uuid from adjusted
$$;
create function noemap_private.is_withdrawn(p_document jsonb,p_category text,p_kind text,p_id text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_document->'withdrawn'->p_category ? p_id, false)
    or coalesce(p_document->'withdrawn'->p_category ? noemap_private.object_uuid('object/'||p_kind||'/'||p_id)::text,false)
    or coalesce(p_document->'withdrawn'->p_category ? noemap_private.object_uuid('revision/'||(p_document->>'release_id')||'/'||p_kind||'/'||p_id)::text,false)
$$;
create function noemap_private.pick(p_value jsonb,p_keys text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_value) where key = any(p_keys)
$$;
create function noemap_private.evidence_available(p_items jsonb,p_sources text[]) returns boolean
language sql immutable set search_path = '' as $$
  select not exists (select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x where not ((x->>'source') = any(p_sources)))
$$;
create function noemap_private.basis_available(p_items jsonb,p_claims text[]) returns boolean
language sql immutable set search_path = '' as $$
  select not exists (select 1 from jsonb_array_elements_text(coalesce(p_items,'[]'::jsonb)) x where not (x = any(p_claims)))
$$;
create function noemap_private.public_evidence(p_items jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(noemap_private.pick(value,array['source','locator','role'])),'[]') from jsonb_array_elements(p_items)
$$;
create function noemap_private.public_proof_fields(p_item jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_item ? 'evidence' then jsonb_set(p_item,'{evidence}',noemap_private.public_evidence(p_item->'evidence')) else p_item end
$$;

-- Project the public release inside the publish transaction. Neither private
-- history nor withdrawn text is reachable through the public Data API.
create function noemap_private.project_document(p_document jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
#variable_conflict use_column
declare
  src jsonb; nd jsonb; cl jsonb; rl jsonb; tm jsonb; b jsonb; x jsonb;
  sources text[]; nodes text[]; claims text[]; old_nodes text[]; old_claims text[];
  output_batches jsonb := '[]'; output_dates jsonb; batch_out jsonb;
begin
  select coalesce(jsonb_agg(x),'[]') into src from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'sources') x;
  select coalesce(jsonb_agg(x),'[]') into nd from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'node_candidates') x;
  select coalesce(jsonb_agg(x),'[]') into cl from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'assertion_candidates') x;
  select coalesce(array_agg(x->>'id'),array[]::text[]) into sources from jsonb_array_elements(src) x where not noemap_private.is_withdrawn(p_document,'sources','source',x->>'id');
  select coalesce(array_agg(x->>'id'),array[]::text[]) into nodes from jsonb_array_elements(nd) x where not noemap_private.is_withdrawn(p_document,'nodes','node',x->>'id');
  select coalesce(array_agg(x->>'id'),array[]::text[]) into claims from jsonb_array_elements(cl) x where not noemap_private.is_withdrawn(p_document,'assertions','assertion',x->>'id') and not noemap_private.is_withdrawn(p_document,'nodes','node',x->>'subject') and noemap_private.evidence_available(x->'evidence',sources);
  loop
    old_nodes := nodes; old_claims := claims;
    select coalesce(array_agg(x->>'id'),array[]::text[]) into claims from jsonb_array_elements(cl) x where x->>'id'=any(old_claims) and x->>'subject'=any(nodes) and noemap_private.basis_available(x->'basis',old_claims);
    select coalesce(array_agg(x->>'id'),array[]::text[]) into nodes from jsonb_array_elements(nd) x where x->>'id'=any(old_nodes) and noemap_private.evidence_available(x->'evidence',sources) and noemap_private.basis_available(x->'basis',claims) and not exists (select 1 from jsonb_array_elements(cl) c where c->>'subject'=x->>'id' and not(c->>'id'=any(claims)));
    exit when old_nodes=nodes and old_claims=claims;
  end loop;
  for b in select value from jsonb_array_elements(p_document->'batches') loop
    select coalesce(jsonb_agg(noemap_private.pick(x,array['id','title','edition','url','author','host','language','accessed_date','translator','editor','editors','usage_notice'])),'[]') into src from jsonb_array_elements(b->'sources') x where x->>'id'=any(sources);
    select coalesce(jsonb_agg(noemap_private.public_proof_fields(noemap_private.pick(x,array['id','type','label','summary_ja','aliases','nature','evidence','basis','definition_scope','scope_limit']))),'[]') into nd from jsonb_array_elements(b->'node_candidates') x where x->>'id'=any(nodes);
    select coalesce(jsonb_agg(noemap_private.public_proof_fields(noemap_private.pick(x,array['id','subject','nature','attribution','text_ja','limit','evidence','basis']))),'[]') into cl from jsonb_array_elements(b->'assertion_candidates') x where x->>'id'=any(claims);
    select coalesce(jsonb_agg(noemap_private.pick(x,array['id','from','to','nature','reason','basis']) || jsonb_build_object('id',coalesce(x->>'id',(b->>'batch_id')||':relation:'||(ord-1)::text))),'[]') into rl from jsonb_array_elements(b->'relationship_candidates') with ordinality r(x,ord)
      where x->>'from'=any(nodes) and x->>'to'=any(nodes) and noemap_private.basis_available(x->'basis',claims)
      and not noemap_private.is_withdrawn(p_document,'relationships','relationship',coalesce(x->>'id',(b->>'batch_id')||':relation:'||(ord-1)::text))
      and not coalesce(p_document->'withdrawn'->'relationships' ? coalesce(x->>'id',(x->>'from')||'->'||(x->>'to')),false);
    batch_out := jsonb_build_object('batch_id',b->>'batch_id','sources',src,'node_candidates',nd,'assertion_candidates',cl,'relationship_candidates',rl);
    output_batches := output_batches || jsonb_build_array(batch_out);
  end loop;
  select coalesce(jsonb_agg(noemap_private.public_proof_fields(noemap_private.pick(x,array['id','node_id','role','date_label','original_label','calendar','normalization','precision','start_earliest','start_latest','end_earliest','end_latest','evidence','text_ja','limit']))),'[]') into output_dates from jsonb_array_elements(p_document->'temporal_records') x where x->>'node_id'=any(nodes) and noemap_private.evidence_available(x->'evidence',sources) and not noemap_private.is_withdrawn(p_document,'assertions','temporal',x->>'id');
  return jsonb_build_object('schema_version',1,'release_id',p_document->>'release_id','publication_status','provisional','human_review',jsonb_build_object('status','pending','reviewer',null,'approved_at',null),'authorized_by','project-owner-request','batches',output_batches,'withdrawn',jsonb_build_object('sources','[]'::jsonb,'nodes','[]'::jsonb,'assertions','[]'::jsonb,'relationships','[]'::jsonb),'temporal_records',output_dates);
end $$;

create function noemap_private.check_fields(p_item jsonb,p_required text[],p_optional text[],p_arrays text[]) returns void
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(p_item) is distinct from 'object' then raise exception 'Invalid item' using errcode='22023'; end if;
  foreach k in array p_required loop
    if jsonb_typeof(p_item->k) is distinct from 'string' or btrim(p_item->>k)='' then raise exception 'Required text field' using errcode='22023'; end if;
  end loop;
  foreach k in array p_optional loop
    if p_item ? k and jsonb_typeof(p_item->k) is distinct from 'string' then raise exception 'Invalid optional text' using errcode='22023'; end if;
  end loop;
  foreach k in array p_arrays loop
    if p_item ? k then
      if jsonb_typeof(p_item->k) is distinct from 'array' then raise exception 'Invalid text list' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(p_item->k) x where jsonb_typeof(x) is distinct from 'string') then raise exception 'Invalid text list item' using errcode='22023'; end if;
    end if;
  end loop;
end $$;
create function noemap_private.check_document(p_document jsonb) returns void
language plpgsql immutable set search_path = '' as $$
#variable_conflict use_column
declare b jsonb; x jsonb; e jsonb; c jsonb; src jsonb; nd jsonb; cl jsonb; rl jsonb; owners jsonb; sources text[]; nodes text[]; claims text[]; all_ids text[]; yr numeric;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>2000000
    or p_document->>'schema_version' is distinct from '1' or p_document->>'publication_status' is distinct from 'provisional'
    or p_document->>'authorized_by' is distinct from 'project-owner-request'
    or p_document->'human_review' is distinct from '{"status":"pending","reviewer":null,"approved_at":null}'::jsonb
    or jsonb_typeof(p_document->'batches') is distinct from 'array' or jsonb_array_length(p_document->'batches')=0
    or jsonb_typeof(p_document->'temporal_records') is distinct from 'array'
  then raise exception 'Invalid provisional document' using errcode='22023'; end if;
  perform noemap_private.check_fields(p_document,array['release_id'],array[]::text[],array[]::text[]);
  if coalesce(length(p_document->>'release_id'),0) not between 1 and 120 then raise exception 'Invalid release ID' using errcode='22023'; end if;
  if exists (
    with recursive walk(value,key,depth) as (
      select p_document,null::text,0
      union all select child.value,child.key,w.depth+1 from walk w cross join lateral (
        select value,key from jsonb_each(case when jsonb_typeof(w.value)='object' then w.value else '{}'::jsonb end)
        union all select value,null::text from jsonb_array_elements(case when jsonb_typeof(w.value)='array' then w.value else '[]'::jsonb end)
      ) child where w.depth<=25
    ) select 1 from walk where depth>24 or (jsonb_typeof(value)='string' and length(value#>>'{}')>6000)
      or (regexp_replace(lower(key),'[-_]','','g')<>'fulltextpublication' and regexp_replace(lower(key),'[-_]','','g') ~ '^(fulltext|rawtext|sourcetext|originaltext|documenttext|documentbody|rawhtml|rawmarkdown|pdftext)|^(transcript|quotedtext|excerpts?)$')
      or (regexp_replace(lower(key),'[-_]','','g')='storedfulltext' and value is distinct from 'false'::jsonb)
  ) then raise exception 'Only summaries and citations can be stored' using errcode='22023'; end if;
  foreach x in array array[p_document->'withdrawn'->'sources',p_document->'withdrawn'->'nodes',p_document->'withdrawn'->'assertions',p_document->'withdrawn'->'relationships'] loop
    if jsonb_typeof(x) is distinct from 'array' then raise exception 'Invalid withdrawals' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(x) t where jsonb_typeof(t) is distinct from 'string' or length(t#>>'{}') not between 1 and 160) then raise exception 'Invalid withdrawal ID' using errcode='22023'; end if;
  end loop;
  for b in select value from jsonb_array_elements(p_document->'batches') loop
    perform noemap_private.check_fields(b,array['batch_id'],array[]::text[],array[]::text[]);
    if jsonb_typeof(b->'sources') is distinct from 'array' or jsonb_typeof(b->'node_candidates') is distinct from 'array' or jsonb_typeof(b->'assertion_candidates') is distinct from 'array' or jsonb_typeof(b->'relationship_candidates') is distinct from 'array' then raise exception 'Invalid batch' using errcode='22023'; end if;
    for x in select value from jsonb_array_elements(b->'sources') loop
      perform noemap_private.check_fields(x,array['id','title','edition','url'],array['author','host','language','accessed_date','translator','editor','usage_notice'],array['editors']);
      if x->>'stored_full_text' is distinct from 'false' or coalesce(x->>'url','') !~ '^https://[^/?#@[:space:]]+([/?#].*)?$' or coalesce(x->>'title','')='' or coalesce(x->>'edition','')='' then raise exception 'Invalid source summary' using errcode='22023'; end if;
    end loop;
  end loop;
  select coalesce(jsonb_agg(x),'[]') into src from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'sources') x;
  select coalesce(jsonb_agg(x),'[]') into nd from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'node_candidates') x;
  select coalesce(jsonb_agg(x),'[]') into cl from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'assertion_candidates') x;
  select coalesce(jsonb_agg(x||jsonb_build_object('id',coalesce(x->>'id',(b->>'batch_id')||':relation:'||(ord-1)::text))),'[]') into rl from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'relationship_candidates') with ordinality r(x,ord);
  select coalesce(array_agg(x->>'id'),array[]::text[]) into sources from jsonb_array_elements(src) x;
  select coalesce(array_agg(x->>'id'),array[]::text[]) into nodes from jsonb_array_elements(nd) x;
  select coalesce(array_agg(x->>'id'),array[]::text[]) into claims from jsonb_array_elements(cl) x;
  select coalesce(array_agg(x->>'id'),array[]::text[]) into all_ids from jsonb_array_elements(src||nd||cl||rl||(p_document->'temporal_records')) x;
  if exists(select 1 from unnest(all_ids) id where id is null or btrim(id)='') or cardinality(all_ids)<>(select count(distinct id) from unnest(all_ids) id)
    or exists(select 1 from jsonb_array_elements(rl) x group by x->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(rl) x group by x->>'from',x->>'to' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_document->'batches') b where coalesce(b->>'batch_id','')='')
    or exists(select 1 from jsonb_array_elements(p_document->'batches') b group by b->>'batch_id' having count(*)>1)
  then raise exception 'Duplicate or missing identifiers' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(nd) loop
    perform noemap_private.check_fields(x,array['id','type','label','summary_ja'],array['nature','definition_scope','scope_limit'],array['aliases','basis']);
    if coalesce(x->>'type','') not in ('question','person','concept','work') or coalesce(x->>'id','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(x->>'id')>96
      or coalesce(btrim(x->>'label'),'')='' or coalesce(btrim(x->>'summary_ja'),'')=''
      or (x->>'type'='concept' and coalesce(btrim(x->>'definition_scope'),'')='')
      or (x ? 'aliases' and (jsonb_typeof(x->'aliases') is distinct from 'array' or exists(select 1 from jsonb_array_elements(x->'aliases') a where jsonb_typeof(a) is distinct from 'string')))
    then raise exception 'Invalid node summary' using errcode='22023'; end if;
    if x->>'nature'='editorial' then
      if jsonb_array_length(coalesce(x->'basis','[]'))=0 then raise exception 'Editorial basis required' using errcode='22023'; end if;
    elsif jsonb_array_length(coalesce(x->'evidence','[]'))=0 then raise exception 'Node evidence required' using errcode='22023'; end if;
  end loop;
  for x in select value from jsonb_array_elements(cl) loop
    perform noemap_private.check_fields(x,array['id','subject','nature','text_ja','limit','attribution'],array[]::text[],array['basis']);
    if not(coalesce(x->>'subject','')=any(nodes)) or coalesce(btrim(x->>'text_ja'),'')='' or coalesce(btrim(x->>'limit'),'')='' or coalesce(btrim(x->>'attribution'),'')='' or jsonb_typeof(x->'nature') is distinct from 'string' or jsonb_array_length(coalesce(x->'evidence','[]'))=0
    then raise exception 'Invalid claim and attribution' using errcode='22023'; end if;
  end loop;
  for x in select value from jsonb_array_elements(rl) loop
    perform noemap_private.check_fields(x,array['id','from','to','nature','reason'],array[]::text[],array['basis']);
    if not(coalesce(x->>'from','')=any(nodes)) or not(coalesce(x->>'to','')=any(nodes)) or x->>'from'=x->>'to' or x->>'nature' is distinct from 'editorial' or coalesce(btrim(x->>'reason'),'')='' or jsonb_array_length(coalesce(x->'basis','[]'))=0
    then raise exception 'Invalid editorial relationship' using errcode='22023'; end if;
  end loop;
  owners:=nd||cl||rl||(p_document->'temporal_records');
  for x in select value from jsonb_array_elements(owners) loop
    if x ? 'evidence' then
      for e in select value from jsonb_array_elements(x->'evidence') loop
        perform noemap_private.check_fields(e,array['source','locator','role'],array[]::text[],array[]::text[]);
        if not(coalesce(e->>'source','')=any(sources)) or coalesce(btrim(e->>'locator'),'')='' or coalesce(e->>'role','') not in ('support','qualification','counter') then raise exception 'Invalid evidence reference' using errcode='22023'; end if;
      end loop;
    end if;
    if x ? 'basis' then
      for e in select value from jsonb_array_elements(x->'basis') loop
        if jsonb_typeof(e) is distinct from 'string' or not((e#>>'{}')=any(claims)) then raise exception 'Invalid editorial basis' using errcode='22023'; end if;
      end loop;
    end if;
  end loop;
  for x in select value from jsonb_array_elements(p_document->'temporal_records') loop
    perform noemap_private.check_fields(x,array['id','node_id','role','normalization','precision','date_label','original_label','calendar','text_ja','limit'],array[]::text[],array[]::text[]);
    select value into c from jsonb_array_elements(nd) where value->>'id'=x->>'node_id';
    if c is null or coalesce(x->>'role','') not in ('birth','death','active','publication','founding') or x->>'normalization' is distinct from 'astronomical_year' or x->>'precision' is distinct from 'year' or coalesce(btrim(x->>'date_label'),'')='' or coalesce(btrim(x->>'original_label'),'')='' or coalesce(btrim(x->>'calendar'),'')='' or coalesce(btrim(x->>'text_ja'),'')='' or coalesce(btrim(x->>'limit'),'')='' or jsonb_array_length(coalesce(x->'evidence','[]'))=0
      or (x->>'role' in ('birth','death') and c->>'type'<>'person') or (x->>'role'='publication' and c->>'type'<>'work') or (x->>'role'='founding' and c->>'type'<>'concept') or (x->>'role'='active' and c->>'type' not in ('person','work','concept'))
      or (x->>'role'<>'active' and (x->'end_earliest' is distinct from 'null'::jsonb or x->'end_latest' is distinct from 'null'::jsonb))
    then raise exception 'Invalid chronology' using errcode='22023'; end if;
    foreach e in array array[x->'start_earliest',x->'start_latest',x->'end_earliest',x->'end_latest'] loop
      if e is distinct from 'null'::jsonb then
        if jsonb_typeof(e) is distinct from 'number' then raise exception 'Invalid chronology year' using errcode='22023'; end if;
        yr:=(e#>>'{}')::numeric;
        if yr<>trunc(yr) or yr < -2147483648 or yr > 2147483647 then raise exception 'Invalid chronology year' using errcode='22023'; end if;
      end if;
    end loop;
    if (x->>'start_earliest')::numeric > (x->>'start_latest')::numeric or (x->>'end_earliest')::numeric > (x->>'end_latest')::numeric or (x->>'start_earliest')::numeric > (x->>'end_latest')::numeric then raise exception 'Invalid chronology range' using errcode='22023'; end if;
  end loop;
end $$;

create function noemap_private.normalize_document(p_document jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
#variable_conflict use_column
declare doc jsonb:=p_document; b jsonb; relations jsonb; batches jsonb:='[]'; category text; entries jsonb; ids jsonb;
begin
  -- Resolve revision-scoped withdrawals before giving a saved version a new
  -- release ID. Explicit relationship IDs also survive array reordering.
  for b in select value from jsonb_array_elements(doc->'batches') loop
    select coalesce(jsonb_agg(x||jsonb_build_object('id',coalesce(x->>'id',(b->>'batch_id')||':relation:'||(ord-1)::text))),'[]') into relations from jsonb_array_elements(b->'relationship_candidates') with ordinality r(x,ord);
    batches:=batches||jsonb_build_array(jsonb_set(b,'{relationship_candidates}',relations));
  end loop;
  doc:=jsonb_set(doc,'{batches}',batches);
  foreach category in array array['sources','nodes','assertions','relationships'] loop
    with objects as (
      select x->>'id' id,'source' kind from jsonb_array_elements(doc->'batches') b cross join lateral jsonb_array_elements(b->'sources') x where category='sources'
      union all select x->>'id','node' from jsonb_array_elements(doc->'batches') b cross join lateral jsonb_array_elements(b->'node_candidates') x where category='nodes'
      union all select x->>'id','assertion' from jsonb_array_elements(doc->'batches') b cross join lateral jsonb_array_elements(b->'assertion_candidates') x where category='assertions'
      union all select x->>'id','temporal' from jsonb_array_elements(doc->'temporal_records') x where category='assertions'
      union all select x->>'id','relationship' from jsonb_array_elements(doc->'batches') b cross join lateral jsonb_array_elements(b->'relationship_candidates') x where category='relationships'
    ), withdrawn_ids as (
      select to_jsonb(id) value from objects where noemap_private.is_withdrawn(doc,category,kind,id)
      union select to_jsonb((b->>'batch_id')||':relation:'||(ord-1)::text) from jsonb_array_elements(p_document->'batches') b cross join lateral jsonb_array_elements(b->'relationship_candidates') with ordinality r(x,ord) where category='relationships' and not(x ? 'id') and coalesce(p_document->'withdrawn'->category ? ((x->>'from')||'->'||(x->>'to')),false)
      union select value from jsonb_array_elements(doc->'withdrawn'->category)
    ) select coalesce(jsonb_agg(value order by value),'[]') into entries from withdrawn_ids;
    doc:=jsonb_set(doc,array['withdrawn',category],entries);
  end loop;
  return doc;
end $$;

-- Privileged functions are private and check a fresh explicit membership before
-- each access. Public RPC wrappers run with the caller's privileges.
create function noemap_private.require_editor() returns noemap_private.editors
language plpgsql stable security definer set search_path = '' as $$
declare e noemap_private.editors;
begin
  if auth.uid() is null then raise exception 'Editor required' using errcode='42501'; end if;
  select * into e from noemap_private.editors where user_id=auth.uid() and enabled;
  if e.user_id is null then raise exception 'Editor required' using errcode='42501'; end if;
  return e;
end $$;
create function noemap_private.editor_identity() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e noemap_private.editors;
begin
  if auth.uid() is null then return null; end if;
  select * into e from noemap_private.editors where user_id=auth.uid() and enabled;
  if e.user_id is null then return null; end if;
  return jsonb_build_object('user_id',e.user_id,'label',e.label);
end $$;
create function noemap_private.snapshot_json(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',id,'document',document,'created_at',created_at,'reason',reason,'actor_label',actor_label) from noemap_private.snapshots where id=p_id
$$;
create function noemap_private.read_editor() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s noemap_private.state; hist jsonb;
begin
  perform noemap_private.require_editor();
  select * into s from noemap_private.state where id;
  if s.current_snapshot_id is null then raise exception 'Database not initialized' using errcode='55000'; end if;
  select coalesce(jsonb_agg(v),'[]') into hist from (select jsonb_build_object('id',id,'created_at',created_at,'reason',reason,'actor_label',actor_label,'status',case when id=s.draft_snapshot_id then 'draft' when id=s.current_snapshot_id then 'published' else 'history' end) v from noemap_private.snapshots order by created_at desc,id desc limit 50) h;
  return jsonb_build_object('generation',s.generation,'current',noemap_private.snapshot_json(s.current_snapshot_id),'draft',noemap_private.snapshot_json(s.draft_snapshot_id),'history',hist);
end $$;
create function noemap_private.read_snapshot(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform noemap_private.require_editor(); return noemap_private.snapshot_json(p_id); end $$;

create function noemap_private.mutate(p_kind text,p_expected_generation bigint,p_document jsonb,p_snapshot_id uuid,p_reason text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e noemap_private.editors; s noemap_private.state; v uuid; doc jsonb; target jsonb; existing jsonb; request jsonb; category text; merged jsonb;
begin
  e := noemap_private.require_editor();
  if p_operation_id is null or p_expected_generation is null or length(btrim(coalesce(p_reason,'')))=0 or length(p_reason)>1000 then raise exception 'Reason and operation are required' using errcode='22023'; end if;
  request := jsonb_build_object('kind',p_kind,'generation',p_expected_generation,'document',p_document,'snapshot_id',p_snapshot_id,'reason',p_reason);
  select * into s from noemap_private.state where id for update;
  if s.current_snapshot_id is null then raise exception 'Database not initialized' using errcode='55000'; end if;
  select o.request into existing from noemap_private.operations o where o.actor_id=e.user_id and o.operation_id=p_operation_id;
  if existing is not null then
    if existing is distinct from request then raise exception 'Operation already used for another request' using errcode='22023'; end if;
    return noemap_private.read_editor();
  end if;
  if s.generation<>p_expected_generation then raise exception 'Concurrent edit; reload current version' using errcode='40001'; end if;
  if p_kind='save' then doc := p_document;
  elsif p_kind='restore' then
    select document into doc from noemap_private.snapshots where id=p_snapshot_id;
    if doc is null then raise exception 'Snapshot not found' using errcode='22023'; end if;
  elsif p_kind='publish' then
    if s.draft_snapshot_id is null then raise exception 'No draft to publish' using errcode='22023'; end if;
    select document into doc from noemap_private.snapshots where id=s.draft_snapshot_id;
  else raise exception 'Unknown operation' using errcode='22023'; end if;
  select document into target from noemap_private.snapshots where id=coalesce(s.draft_snapshot_id,s.current_snapshot_id);
  perform noemap_private.check_document(doc);
  doc:=noemap_private.normalize_document(doc);
  target:=noemap_private.normalize_document(target);
  -- Tombstones accumulate across edits, publishing and recovery. Reintroduction
  -- needs a new stable object ID; a silent restore cannot undo a withdrawal.
  foreach category in array array['sources','nodes','assertions','relationships'] loop
    select coalesce(jsonb_agg(value order by value),'[]') into merged from (select distinct value from jsonb_array_elements(coalesce(doc->'withdrawn'->category,'[]')||coalesce(target->'withdrawn'->category,'[]'))) u;
    doc := jsonb_set(doc,array['withdrawn',category],merged);
  end loop;
  perform noemap_private.check_document(doc);
  if p_kind='publish' then
    -- The draft identity remains the content revision identity on publication.
    v := s.draft_snapshot_id;
    update noemap_private.state set generation=generation+1,current_snapshot_id=v,draft_snapshot_id=null where id;
    update public.noemap_public_release set generation=s.generation+1,snapshot_id=v,document=noemap_private.project_document(doc),updated_at=now() where id;
  else
    v := gen_random_uuid(); doc := jsonb_set(doc,'{release_id}',to_jsonb('noemap-persistent-'||v::text));
    insert into noemap_private.snapshots(id,document,created_by,actor_label,reason) values(v,doc,e.user_id,e.label,p_reason);
    update noemap_private.state set generation=generation+1,draft_snapshot_id=v where id;
  end if;
  insert into noemap_private.operations(actor_id,operation_id,request) values(e.user_id,p_operation_id,request);
  return noemap_private.read_editor();
end $$;

create function public.noemap_editor_identity() returns jsonb language sql stable security invoker set search_path = '' as $$ select noemap_private.editor_identity() $$;
create function public.noemap_read_editor() returns jsonb language sql stable security invoker set search_path = '' as $$ select noemap_private.read_editor() $$;
create function public.noemap_read_snapshot(p_snapshot_id uuid) returns jsonb language sql stable security invoker set search_path = '' as $$ select noemap_private.read_snapshot(p_snapshot_id) $$;
create function public.noemap_save_draft(p_expected_generation bigint,p_document jsonb,p_reason text,p_operation_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select noemap_private.mutate('save',p_expected_generation,p_document,null,p_reason,p_operation_id) $$;
create function public.noemap_publish_draft(p_expected_generation bigint,p_reason text,p_operation_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select noemap_private.mutate('publish',p_expected_generation,null,null,p_reason,p_operation_id) $$;
create function public.noemap_restore_draft(p_expected_generation bigint,p_snapshot_id uuid,p_reason text,p_operation_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select noemap_private.mutate('restore',p_expected_generation,null,p_snapshot_id,p_reason,p_operation_id) $$;

revoke all on all functions in schema noemap_private from public, anon, authenticated;
grant usage on schema noemap_private to authenticated;
grant execute on function noemap_private.editor_identity(),noemap_private.read_editor(),noemap_private.read_snapshot(uuid),noemap_private.mutate(text,bigint,jsonb,uuid,text,uuid) to authenticated;
revoke all on function public.noemap_editor_identity(),public.noemap_read_editor(),public.noemap_read_snapshot(uuid),public.noemap_save_draft(bigint,jsonb,text,uuid),public.noemap_publish_draft(bigint,text,uuid),public.noemap_restore_draft(bigint,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.noemap_editor_identity(),public.noemap_read_editor(),public.noemap_read_snapshot(uuid),public.noemap_save_draft(bigint,jsonb,text,uuid),public.noemap_publish_draft(bigint,text,uuid),public.noemap_restore_draft(bigint,uuid,text,uuid) to authenticated;
