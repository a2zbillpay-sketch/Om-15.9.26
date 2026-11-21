import { IncomingMessage, ServerResponse } from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CATEGORIES_FILE = path.resolve(DATA_DIR, 'categories.json');

interface CategoryPayload {
  id: string;
  name: string;
  imageUrl: string;
  displayOrder: number;
}

function loadCategoriesFromFile(): CategoryPayload[] {
  try {
    if (fs.existsSync(CATEGORIES_FILE)) {
      const content = fs.readFileSync(CATEGORIES_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read categories.json:', err);
  }
  return [];
}

function saveCategoriesToFile(categories: CategoryPayload[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${CATEGORIES_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(categories, null, 2), 'utf8');
    fs.renameSync(tempFile, CATEGORIES_FILE);
  } catch (err) {
    console.error('Failed to write categories.json:', err);
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function getServerSupabaseClient(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (
    !url ||
    !key ||
    url === 'https://your-project.supabase.co' ||
    key === 'your-service-role-key' ||
    key === 'your-anon-key'
  ) {
    return null;
  }

  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return null;
  }
}

function mapCategoryRow(row: any, fallbackIndex: number): CategoryPayload {
  const rawOrder =
    typeof row?.sort_order === 'number'
      ? row.sort_order
      : typeof row?.display_order === 'number'
      ? row.display_order
      : fallbackIndex + 1;
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    imageUrl: row?.image_url ? String(row.image_url) : '',
    displayOrder: rawOrder,
  };
}

function isMissingColumnError(err: any, columnName: string): boolean {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const code = String(err.code || '');
  return (
    (code === '42703' || code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache')) &&
    msg.includes(columnName.toLowerCase())
  );
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase();

  // Public GET: Fetch categories from server via Service Role (or file fallback if unconfigured)
  if (method === 'GET') {
    const supabase = getServerSupabaseClient();
    if (!supabase) {
      return sendJson(res, 200, { success: true, categories: loadCategoriesFromFile() });
    }

    try {
      const { data, error } = await supabase.from('categories').select('*');
      if (error) {
        return sendJson(res, 500, { success: false, error: error.message || 'Failed to fetch categories' });
      }

      const mapped = (data || []).map((row: any, idx: number) => mapCategoryRow(row, idx));
      mapped.sort((a, b) => a.displayOrder - b.displayOrder);
      return sendJson(res, 200, { success: true, categories: mapped });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error fetching categories' });
    }
  }

  // Enforce Shopkeeper/Admin authorization for all mutations
  const session = verifyAdminSession(req);
  if (!session || session.role !== 'SHOPKEEPER') {
    return sendJson(res, 401, {
      success: false,
      error: 'Unauthorized: Shopkeeper session required. Please log in.',
    });
  }

  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return sendJson(res, 405, { success: false, error: `Method ${method} Not Allowed` });
  }

  const supabase = getServerSupabaseClient();

  if (method === 'POST' || method === 'PUT') {
    try {
      const body = await parseJsonBody(req);

      // Reorder Action: Persists order without assuming display_order column exists
      if (body.action === 'reorder' && Array.isArray(body.categories)) {
        const reordered: CategoryPayload[] = body.categories.map((cat: any, idx: number) => ({
          id: String(cat?.id || '').trim(),
          name: String(cat?.name || '').trim(),
          imageUrl: cat?.imageUrl ? String(cat.imageUrl).trim() : '',
          displayOrder: idx + 1,
        }));
        saveCategoriesToFile(reordered);

        if (supabase) {
          for (let i = 0; i < reordered.length; i++) {
            const c = reordered[i];
            if (!c.id) continue;
            const updatePayload: Record<string, any> = {
              sort_order: i + 1,
              updated_at: new Date().toISOString(),
            };
            const { error } = await supabase
              .from('categories')
              .update(updatePayload)
              .eq('id', c.id);

            if (error && isMissingColumnError(error, 'sort_order')) {
              // Schema does not have sort_order or display_order; file fallback already persisted
              break;
            }
          }
        }

        return sendJson(res, 200, { success: true, categories: reordered });
      }

      const cleanId = String(body.id || `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`).trim();
      const cleanName = String(body.name || '').trim();
      if (!cleanName) {
        return sendJson(res, 400, { success: false, error: 'Category name is required.' });
      }

      const cleanImageUrl = body.imageUrl ? String(body.imageUrl).trim() : '';
      const resolvedOrder = typeof body.displayOrder === 'number' ? body.displayOrder : 1;

      if (!supabase) {
        const existing = loadCategoriesFromFile();
        const catObj: CategoryPayload = {
          id: cleanId,
          name: cleanName,
          imageUrl: cleanImageUrl,
          displayOrder: resolvedOrder,
        };
        const idx = existing.findIndex((c) => c.id === cleanId);
        if (idx >= 0) existing[idx] = catObj;
        else existing.push(catObj);
        saveCategoriesToFile(existing);
        return sendJson(res, 200, { success: true, category: catObj });
      }

      const payload: Record<string, any> = {
        id: cleanId,
        name: cleanName,
        image_url: cleanImageUrl || null,
        sort_order: resolvedOrder,
        updated_at: new Date().toISOString(),
      };

      let upsertRes = await supabase
        .from('categories')
        .upsert(payload, { onConflict: 'id' })
        .select('*')
        .maybeSingle();

      if (upsertRes.error && isMissingColumnError(upsertRes.error, 'sort_order')) {
        delete payload.sort_order;
        upsertRes = await supabase
          .from('categories')
          .upsert(payload, { onConflict: 'id' })
          .select('*')
          .maybeSingle();
      }

      if (upsertRes.error && isMissingColumnError(upsertRes.error, 'updated_at')) {
        delete payload.updated_at;
        upsertRes = await supabase
          .from('categories')
          .upsert(payload, { onConflict: 'id' })
          .select('*')
          .maybeSingle();
      }

      if (upsertRes.error) {
        return sendJson(res, 500, {
          success: false,
          error: upsertRes.error.message || 'Failed to save category to database.',
        });
      }

      const savedCat = upsertRes.data
        ? mapCategoryRow(upsertRes.data, resolvedOrder - 1)
        : {
            id: cleanId,
            name: cleanName,
            imageUrl: cleanImageUrl,
            displayOrder: resolvedOrder,
          };

      const currentFileCats = loadCategoriesFromFile();
      const idx = currentFileCats.findIndex((c) => c.id === savedCat.id);
      if (idx >= 0) currentFileCats[idx] = savedCat;
      else currentFileCats.push(savedCat);
      saveCategoriesToFile(currentFileCats);

      return sendJson(res, 200, { success: true, category: savedCat });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error saving category' });
    }
  }

  if (method === 'DELETE') {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      let categoryId = url.searchParams.get('id');
      if (!categoryId) {
        const body = await parseJsonBody(req).catch(() => ({}));
        categoryId = body?.id;
      }

      if (!categoryId || !String(categoryId).trim()) {
        return sendJson(res, 400, { success: false, error: 'Category ID is required for deletion.' });
      }
      const targetId = String(categoryId).trim();

      if (supabase) {
        try {
          await supabase
            .from('products')
            .update({ category_id: null })
            .eq('category_id', targetId);
        } catch {
          // Non-fatal if category_id column is absent
        }

        const { error } = await supabase
          .from('categories')
          .delete()
          .eq('id', targetId);

        if (error) {
          return sendJson(res, 500, {
            success: false,
            error: error.message || 'Failed to delete category from database.',
          });
        }
      }

      const currentFileCats = loadCategoriesFromFile();
      const filtered = currentFileCats.filter((c) => c.id !== targetId);
      if (filtered.length !== currentFileCats.length) {
        saveCategoriesToFile(filtered);
      }

      return sendJson(res, 200, { success: true, deletedId: targetId });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error deleting category' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return sendJson(res, 405, { success: false, error: `Method ${method} Not Allowed` });
}
