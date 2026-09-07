create table if not exists public.journal_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection text not null check (collection in ('images', 'notes', 'restyles', 'inspirations', 'roomNames', 'firstDesignDrafts', 'firstDesigns')),
  record_id text not null,
  room_id text,
  data jsonb not null default '{}'::jsonb,
  files jsonb not null default '{}'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, collection, record_id)
);

create index if not exists journal_records_room_idx
  on public.journal_records (user_id, collection, room_id, created_at desc);

alter table public.journal_records enable row level security;
revoke all on table public.journal_records from anon, authenticated;
grant select, insert, update, delete on table public.journal_records to authenticated;

create policy "Users read their own journal records"
  on public.journal_records for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users create their own journal records"
  on public.journal_records for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update their own journal records"
  on public.journal_records for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users delete their own journal records"
  on public.journal_records for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'journal-media', 'journal-media', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

create policy "Users read their own journal media"
  on storage.objects for select to authenticated
  using (bucket_id = 'journal-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload their own journal media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'journal-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update their own journal media"
  on storage.objects for update to authenticated
  using (bucket_id = 'journal-media' and owner_id = (select auth.uid())::text)
  with check (bucket_id = 'journal-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete their own journal media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'journal-media' and owner_id = (select auth.uid())::text);

create or replace function public.cicerostrasse_connection_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'connected', true,
    'project_ref', 'jwbwnbbaetgwmhiouzcu',
    'schema_version', 2
  );
$$;
