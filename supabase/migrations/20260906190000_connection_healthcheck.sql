create or replace function public.cicerostrasse_connection_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'connected', true,
    'project_ref', 'jwbwnbbaetgwmhiouzcu',
    'schema_version', 1
  );
$$;

revoke all on function public.cicerostrasse_connection_status() from public;
grant execute on function public.cicerostrasse_connection_status() to anon, authenticated;

comment on function public.cicerostrasse_connection_status() is
  'Non-sensitive connection probe used by the Cicerostrasse client.';
