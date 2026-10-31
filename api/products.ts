import { IncomingMessage, ServerResponse } from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';
import {
  normalizeAndValidateProduct,
  saveProductWithCascadeSync,
  deleteProductWithCascade,
} from '../src/lib/product-service';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRODUCTS_FILE = path.resolve(DATA_DIR, 'products.json');

function loadProductsFromFile(): any[] {
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      const content = fs.readFileSync(PRODUCTS_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read products.json:', err);
  }
  return [];
}

function saveProductsToFile(products: any[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${PRODUCTS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(products, null, 2), 'utf8');
    fs.renameSync(tempFile, PRODUCTS_FILE);
  } catch (err) {
    console.error('Failed to write products.json:', err);
  }
}

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
  const method = req.method?.toUpperCase();
  const supabase = getServerSupabaseClient();

  // Public GET: Fetch persistent products from server storage
  if (method === 'GET') {
    const list = loadProductsFromFile();
    return sendJson(res, 200, { success: true, products: list });
  }

  // Enforce Shopkeeper/Admin authorization for mutations
  const session = verifyAdminSession(req);
  if (!session || session.role !== 'SHOPKEEPER') {
    return sendJson(res, 401, {
      error: 'Unauthorized: Shopkeeper session required. Please log in.',
    });
  }

  if (method === 'POST') {
    try {
      const body = await parseJsonBody(req);

      // Reorder Action: Updates display order sequence across all products
      if (body.action === 'reorder' && Array.isArray(body.products)) {
        const reordered = body.products.map((p: any, idx: number) => ({
          ...p,
          displayOrder: idx + 1,
        }));
        saveProductsToFile(reordered);

        if (supabase) {
          for (let i = 0; i < reordered.length; i++) {
            const pid = reordered[i].id;
            if (pid) {
              try {
                await supabase
                  .from('products')
                  .update({ display_order: i + 1, updated_at: new Date().toISOString() })
                  .eq('id', pid);
              } catch {
                // Ignore if display_order column not yet provisioned in Supabase table
              }
            }
          }
        }

        return sendJson(res, 200, { success: true, products: reordered });
      }

      const validation = normalizeAndValidateProduct(body);

      if (!validation.valid || !validation.product) {
        return sendJson(res, 400, { error: validation.error || 'Invalid product data' });
      }

      const product = validation.product;

      // Also persist to products.json
      const currentProducts = loadProductsFromFile();
      const existingIdx = currentProducts.findIndex((p: any) => p.id === product.id);
      if (existingIdx >= 0) {
        currentProducts[existingIdx] = product;
      } else {
        product.displayOrder = currentProducts.length + 1;
        currentProducts.push(product);
      }
      saveProductsToFile(currentProducts);

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

      // Update in products.json
      const currentProducts = loadProductsFromFile();
      const existingIdx = currentProducts.findIndex((p: any) => p.id === product.id);
      if (existingIdx >= 0) {
        currentProducts[existingIdx] = {
          ...currentProducts[existingIdx],
          ...product,
          displayOrder: currentProducts[existingIdx].displayOrder ?? product.displayOrder ?? (existingIdx + 1),
        };
        saveProductsToFile(currentProducts);
      } else {
        product.displayOrder = currentProducts.length + 1;
        currentProducts.push(product);
        saveProductsToFile(currentProducts);
      }

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

      // Remove from products.json
      const currentProducts = loadProductsFromFile();
      const updatedList = currentProducts.filter((p: any) => p.id !== productId);
      if (updatedList.length !== currentProducts.length) {
        saveProductsToFile(updatedList);
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
