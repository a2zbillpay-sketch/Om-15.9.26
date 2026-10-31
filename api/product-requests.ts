import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

function getServerSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-anon-key') {
    return createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  // 1. Strictly allow only GET requests
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end(
      JSON.stringify({
        success: false,
        error: `Method ${req.method} Not Allowed. Only GET is permitted.`,
      })
    );
    return;
  }

  // 2. Enforce verified SHOPKEEPER session
  const session = verifyAdminSession(req);
  if (!session || session.role !== 'SHOPKEEPER') {
    res.statusCode = 401;
    res.end(
      JSON.stringify({
        success: false,
        error: 'Unauthorized: Shopkeeper session required.',
      })
    );
    return;
  }

  // 3. Query Supabase securely from backend using service role
  const supabase = getServerSupabaseClient();
  if (!supabase) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: 'Database service is not configured or unavailable.',
      })
    );
    return;
  }

  try {
    const { data, error } = await supabase
      .from('product_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          success: false,
          error: error.message || 'Failed to query product requests.',
        })
      );
      return;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        requests: data || [],
      })
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: err?.message || 'Internal server error.',
      })
    );
  }
}
