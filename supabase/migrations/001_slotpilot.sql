-- Run once in Supabase SQL Editor. All access is server-only through service_role.
create extension if not exists btree_gist with schema extensions;
create table if not exists public.slotpilot_state (
 namespace text primary key check (namespace ~ '^slotpilot-[A-Za-z0-9_-]{1,80}$'),
 revision bigint not null default 0,
 document jsonb not null check (jsonb_typeof(document)='object' and (document->>'schemaVersion') is not distinct from '1'),
 updated_at timestamptz not null default now()
);
create table if not exists public.slotpilot_reservations (
 namespace text not null references public.slotpilot_state(namespace) on delete cascade,
 reservation_id text not null, resource_id text not null,
 resource_kind text not null check (resource_kind in ('technician','bay')),
 starts_at timestamptz not null, ends_at timestamptz not null,
 primary key(namespace,reservation_id), check (ends_at>starts_at),
 exclude using gist (namespace with =,resource_kind with =,resource_id with =,tstzrange(starts_at,ends_at,'[)') with &&)
);
create table if not exists public.slotpilot_rate_limits(namespace text not null, bucket_key text not null, window_start timestamptz not null, count integer not null, primary key(namespace,bucket_key));
alter table public.slotpilot_state enable row level security;
alter table public.slotpilot_reservations enable row level security;
alter table public.slotpilot_rate_limits enable row level security;
revoke all on public.slotpilot_state,public.slotpilot_reservations,public.slotpilot_rate_limits from public,anon,authenticated;

create or replace function public.slotpilot_load(p_namespace text,p_initial jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 insert into slotpilot_state(namespace,document) values(p_namespace,p_initial) on conflict do nothing;
 select jsonb_build_object('revision',revision,'document',document) into result from slotpilot_state where namespace=p_namespace;
 return result;
end $$;

-- Namespace-level optimistic serialization is intentional for the small 7-day demo.
-- Revision CAS, document (bookings + operation result), and BOTH resources commit together.
-- Range exclusion is a second, database-enforced defence against programming mistakes.
create or replace function public.slotpilot_commit(p_namespace text,p_expected_revision bigint,p_document jsonb,p_reservations jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare rev bigint; item jsonb;
begin
 select revision into rev from slotpilot_state where namespace=p_namespace for update;
 if rev is null or rev<>p_expected_revision then return jsonb_build_object('committed',false); end if;
 if jsonb_typeof(p_reservations)<>'array' or jsonb_array_length(p_reservations)>2000 then raise exception 'Invalid reservations'; end if;
 delete from slotpilot_reservations where namespace=p_namespace;
 for item in select value from jsonb_array_elements(p_reservations) loop
  insert into slotpilot_reservations(namespace,reservation_id,resource_id,resource_kind,starts_at,ends_at)
  values(p_namespace,item->>'id',item->>'resourceId',item->>'resourceKind',(item->>'startAt')::timestamptz,(item->>'endAt')::timestamptz);
 end loop;
 update slotpilot_state set document=p_document,revision=revision+1,updated_at=clock_timestamp() where namespace=p_namespace;
 return jsonb_build_object('committed',true,'revision',rev+1);
end $$;

create or replace function public.slotpilot_rate_limit(p_namespace text,p_key text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare n integer;
begin
 insert into slotpilot_rate_limits(namespace,bucket_key,window_start,count) values(p_namespace,p_key,clock_timestamp(),1)
 on conflict(namespace,bucket_key) do update set
 count=case when slotpilot_rate_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) then 1 else slotpilot_rate_limits.count+1 end,
 window_start=case when slotpilot_rate_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else slotpilot_rate_limits.window_start end
 returning count into n;
 return n<=p_limit;
end $$;
revoke all on function public.slotpilot_load(text,jsonb),public.slotpilot_commit(text,bigint,jsonb,jsonb),public.slotpilot_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.slotpilot_load(text,jsonb),public.slotpilot_commit(text,bigint,jsonb,jsonb),public.slotpilot_rate_limit(text,text,integer,integer) to service_role;
grant all on public.slotpilot_state,public.slotpilot_reservations,public.slotpilot_rate_limits to service_role;
