import { createClient } from '@supabase/supabase-js';

const environment = import.meta.env || {};
const projectUrl = String(environment.VITE_SUPABASE_URL || '').trim();
const publishableKey = String(environment.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
let client;

export function supabaseConfiguration() {
  if (!projectUrl || !publishableKey) return { configured: false, reason: 'missing_environment' };
  try {
    const url = new URL(projectUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) throw new Error();
  } catch {
    return { configured: false, reason: 'invalid_url' };
  }
  return { configured: true, url: projectUrl };
}

export function getSupabaseClient() {
  if (!supabaseConfiguration().configured) return null;
  client ||= createClient(projectUrl, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export async function checkSupabaseConnection(timeoutMs = 6000) {
  const supabase = getSupabaseClient();
  if (!supabase) return { connected: false, reason: supabaseConfiguration().reason };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { data, error } = await supabase.rpc('cicerostrasse_connection_status').abortSignal(controller.signal);
    if (error) throw error;
    return data?.connected === true
      ? { connected: true, projectRef: data.project_ref, schemaVersion: data.schema_version }
      : { connected: false, reason: 'unexpected_response' };
  } catch (error) {
    return { connected: false, reason: error?.name === 'AbortError' ? 'timeout' : 'request_failed' };
  } finally {
    clearTimeout(timeout);
  }
}
