import test from 'node:test';
import assert from 'node:assert/strict';

test('Supabase configuration is optional in test and offline environments', async () => {
  const { supabaseConfiguration, getSupabaseClient, checkSupabaseConnection } = await import('../src/supabase.js');
  assert.deepEqual(supabaseConfiguration(), { configured: false, reason: 'missing_environment' });
  assert.equal(getSupabaseClient(), null);
  assert.deepEqual(await checkSupabaseConnection(), { connected: false, reason: 'missing_environment' });
});
