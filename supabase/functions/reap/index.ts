/**
 * Sweeper, for projects without pg_cron.
 *
 * Deploy with `supabase functions deploy reap` and schedule it every 60
 * seconds. It calls the same `reap_expired()` function the pg_cron job calls,
 * so there is exactly one definition of what "expired" means.
 *
 * The migration schedules pg_cron automatically where the extension is
 * available; this exists for the projects where it is not.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', { status: 500 });
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reap_expired`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const removed = await response.text();
  if (!response.ok) {
    return new Response(`reap_expired failed: ${removed}`, { status: 502 });
  }

  return new Response(JSON.stringify({ removed: Number(removed) || 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
