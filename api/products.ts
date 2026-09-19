import { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/verify.ts';
import {
  normalizeAndValidateProduct,
  saveProductWithCascadeSync,
  deleteProductWithCascade,
} from '../src/lib/product-service.ts';

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getServerSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  // Prefer service role key for backend writes if available; otherwise use anon key
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
  // Enforce Shopkeeper/Admin authorization
  const session = verifyAdminSession(req);
  if (!session || session.role !== 'SHOPKEEPER') {
    return sendJson(res, 401, {
      error: 'Unauthorized: Shopkeeper session required. Please log in.',
    });
  }

  const method = req.method?.toUpperCase();
  const supabase = getServerSupabaseClient();

  if (method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const validation = normalizeAndValidateProduct(body);

      if (!validation.valid || !validation.product) {
        return sendJson(res, 400, { error: validation.error || 'Invalid product data' });
      }

      const product = validation.product;

      // If Supabase is configured, persist with cascade sync
      if (supabase) {
        const dbResult = await saveProductWithCascadeSync(supabase, product);
        if (!dbResult.success) {
          return sendJson(res, 500, { error: dbResult.error || 'Failed to save product to database' });
        }
      }

      return sendJson(res, 201, { success: true, product });
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'Server error creating product' });
    }
  }

  if (method === 'PUT') {
    try {
      const body = await parseJsonBody(req);
      const validation = normalizeAndValidateProduct(body);

      if (!validation.valid || !validation.product) {
        return sendJson(res, 400, { error: validation.error || 'Invalid product data' });
      }

      const product = validation.product;

      if (supabase) {
        const dbResult = await saveProductWithCascadeSync(supabase, product);
        if (!dbResult.success) {
          return sendJson(res, 500, { error: dbResult.error || 'Failed to update product in database' });
        }
      }

      return sendJson(res, 200, { success: true, product });
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'Server error updating product' });
    }
  }

  if (method === 'DELETE') {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      let productId = url.searchParams.get('id');

      if (!productId) {
        const body = await parseJsonBody(req).catch(() => ({}));
        productId = body.id;
      }

      if (!productId) {
        return sendJson(res, 400, { error: 'Product ID is required for deletion' });
      }

      if (supabase) {
        const dbResult = await deleteProductWithCascade(supabase, productId);
        if (!dbResult.success) {
          return sendJson(res, 500, { error: dbResult.error || 'Failed to delete product' });
        }
      }

      return sendJson(res, 200, { success: true, deletedId: productId });
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'Server error deleting product' });
    }
  }

  // Unsupported method
  res.setHeader('Allow', 'POST, PUT, DELETE');
  return sendJson(res, 405, { error: `Method ${method} Not Allowed` });
}
