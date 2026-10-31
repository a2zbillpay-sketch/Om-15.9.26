import type { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

export interface CategoryItem {
  id: string;
  name: string;
  imageUrl?: string;
  display_order?: number;
}

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-service-role-key') {
    try {
      return createClient(url, key, { auth: { persistSession: false } });
    } catch {
      return null;
    }
  }
  return null;
}

export async function loadCategories(): Promise<CategoryItem[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, image_url, display_order')
        .order('display_order', { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((row, idx) => ({
          id: String(row.id),
          name: String(row.name || '').trim(),
          imageUrl: (row.image_url && String(row.image_url).trim()) || '',
          display_order: typeof row.display_order === 'number' ? row.display_order : idx + 1,
        }));
      }
    } catch {
      // Non-fatal if categories table is not provisioned
    }
  }
  return [];
}

async function syncCategoryToSupabaseIfConfigured(
  category: CategoryItem,
  orderIndex?: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' };

  try {
    const resolvedOrder = typeof orderIndex === 'number'
      ? orderIndex
      : (typeof category.display_order === 'number' ? category.display_order : undefined);

    const payload: Record<string, any> = {
      id: category.id,
      name: category.name.trim(),
      image_url: category.imageUrl && category.imageUrl.trim() ? category.imageUrl.trim() : null,
      updated_at: new Date().toISOString(),
    };
    if (typeof resolvedOrder === 'number') {
      payload.display_order = resolvedOrder;
    }
    const { error } = await supabase.from('categories').upsert(payload, { onConflict: 'id' });
    if (error && !error.message?.includes('schema cache')) {
      console.warn('Supabase categories table upsert note:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Database error' };
  }
}

async function deleteCategoryFromSupabaseIfConfigured(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' };

  try {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) {
      console.warn('Supabase categories delete note:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Database error' };
  }
}

/**
 * Safely removes a replaced or deleted category photo from Supabase Storage 'product-images' bucket.
 * CRITICAL SAFETY RULES:
 * 1. Must be from Supabase Storage 'product-images' bucket.
 * 2. Must NOT be an Unsplash URL, external link, or local asset (/logo.jpg).
 * 3. Must NOT be used in any other category.
 * 4. Executed only AFTER new photo and category data are successfully saved.
 */
async function safelyDeleteOldStorageImage(
  oldUrl: string | undefined,
  newUrl: string | undefined,
  currentCategories: CategoryItem[],
  targetCategoryId: string
): Promise<void> {
  if (!oldUrl || !oldUrl.trim() || oldUrl === newUrl) return;

  // 1. Must be hosted on our Supabase Storage 'product-images' bucket
  if (!oldUrl.includes('/storage/v1/object/public/product-images/')) {
    return; // Keep external images, Unsplash photos, and local assets safe
  }

  // 2. Must NOT be used in any other category
  const isUsedInOtherCategory = currentCategories.some(
    (c) => c.id !== targetCategoryId && c.imageUrl === oldUrl
  );
  if (isUsedInOtherCategory) {
    return;
  }

  // 3. Extract the object path in the bucket
  const bucketMarker = '/product-images/';
  const markerIndex = oldUrl.indexOf(bucketMarker);
  if (markerIndex === -1) return;

  const storagePath = decodeURIComponent(oldUrl.substring(markerIndex + bucketMarker.length).split('?')[0]);
  if (!storagePath) return;

  // CRITICAL RULE 8: Only allowed within 'categories/' folder. Never delete product photos, logos, or PWA icons!
  if (!storagePath.startsWith('categories/')) {
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase.storage.from('product-images').remove([storagePath]);
    if (error) {
      console.warn('Notice: Non-fatal storage remove response:', error.message);
    }
  } catch (err) {
    console.warn('Exception during old storage image cleanup:', err);
  }
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
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

function setNoCacheHeaders(res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setNoCacheHeaders(res);
  const method = req.method?.toUpperCase();

  // 1. GET: Fetch all persisted categories (Public read for all users/customers)
  if (method === 'GET') {
    const categories = await loadCategories();
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        categories,
        timestamp: Date.now(),
      })
    );
    return;
  }

  // Enforce Shopkeeper/Admin authorization for all mutation requests (PUT, POST, DELETE)
  const session = verifyAdminSession(req);
  if (!session || session.role !== 'SHOPKEEPER') {
    res.statusCode = 401;
    res.end(
      JSON.stringify({
        success: false,
        error: 'Unauthorized: Shopkeeper session required. Please log in.',
      })
    );
    return;
  }

  // 2. PUT or POST: Update a category, batch update, or upload category image
  if (method === 'PUT' || method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const current = await loadCategories();

      // Case A: Image upload action (Admin only -> direct to Supabase Storage 'product-images' bucket)
      if (body.action === 'upload' || (body.dataUrl && !body.category && !body.categories)) {
        const { dataUrl, fileName, folder = 'categories' } = body;
        if (!dataUrl || typeof dataUrl !== 'string') {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: 'dataUrl string is required for photo upload.' }));
          return;
        }

        const matches = dataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: 'Invalid data URL format. Expected base64 image data.' }));
          return;
        }

        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        if (buffer.length > 5 * 1024 * 1024) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, error: 'File size exceeds maximum 5 MB limit.' }));
          return;
        }

        let ext = 'jpg';
        if (mimeType.includes('png')) ext = 'png';
        else if (mimeType.includes('webp')) ext = 'webp';
        else if (mimeType.includes('gif')) ext = 'gif';
        else if (mimeType.includes('jpeg')) ext = 'jpg';

        const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '') || 'categories';
        const prefix = safeFolder === 'categories' ? 'cat' : 'prod';
        const uniqueFileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
        const filePath = `${safeFolder}/${uniqueFileName}`;

        const supabase = getSupabaseClient();
        if (!supabase) {
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: 'Supabase client could not be initialized.' }));
          return;
        }

        const { error: uploadError } = await supabase.storage.from('product-images').upload(filePath, buffer, {
          contentType: mimeType,
          upsert: false,
        });

        if (uploadError) {
          console.error('Supabase storage upload error:', uploadError.message);
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: uploadError.message }));
          return;
        }

        const { data: publicData } = supabase.storage.from('product-images').getPublicUrl(filePath);
        if (!publicData || !publicData.publicUrl) {
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: 'Failed to retrieve public URL from cloud storage.' }));
          return;
        }

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            url: publicData.publicUrl,
            fileName: uniqueFileName,
            sizeBytes: buffer.length,
            isCloudStorage: true,
          })
        );
        return;
      }

      // Case B: Batch replace all categories
      if (Array.isArray(body.categories)) {
        const validatedCategories: CategoryItem[] = body.categories.map((c: any, idx: number) => ({
          id: String(c.id || `cat-${Date.now()}`),
          name: String(c.name || '').trim(),
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() : '',
          display_order: typeof c.displayOrder === 'number' ? c.displayOrder : (typeof c.display_order === 'number' ? c.display_order : idx + 1),
        })).filter((c: CategoryItem) => c.name.length > 0);

        for (let i = 0; i < validatedCategories.length; i++) {
          await syncCategoryToSupabaseIfConfigured(validatedCategories[i], validatedCategories[i].display_order ?? (i + 1));
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, categories: validatedCategories }));
        return;
      }

      // Case C: Single category update or insert
      const catData = body.category || body;
      if (!catData || !catData.name || !catData.name.trim()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'Category name is required.' }));
        return;
      }

      const categoryId = catData.id || `cat-${Date.now()}`;
      const existingIndex = current.findIndex((c) => c.id === categoryId);
      const existingOrder = existingIndex >= 0 ? current[existingIndex].display_order : undefined;
      const orderIndex = typeof catData.displayOrder === 'number'
        ? catData.displayOrder
        : (typeof catData.display_order === 'number'
          ? catData.display_order
          : (existingOrder ?? (existingIndex >= 0 ? existingIndex + 1 : current.length + 1)));

      const updatedItem: CategoryItem = {
        id: categoryId,
        name: String(catData.name).trim(),
        imageUrl: catData.imageUrl ? String(catData.imageUrl).trim() : '',
        display_order: orderIndex,
      };

      const oldImageUrl = existingIndex >= 0 ? current[existingIndex].imageUrl : undefined;
      let updatedList: CategoryItem[];

      if (existingIndex >= 0) {
        updatedList = [...current];
        updatedList[existingIndex] = updatedItem;
      } else {
        updatedList = [...current, updatedItem];
      }

      await syncCategoryToSupabaseIfConfigured(updatedItem, orderIndex);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          category: updatedItem,
          categories: updatedList,
        })
      );
      return;
    } catch (err: any) {
      console.error('Error saving category:', err);
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: err?.message || 'Server error saving category' }));
      return;
    }
  }

  // 3. DELETE: Remove a category by ID (Admin only)
  if (method === 'DELETE') {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      const id = url.searchParams.get('id');

      if (!id) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'Category id is required' }));
        return;
      }

      const current = await loadCategories();
      const updatedList = current.filter((c) => c.id !== id);
      await deleteCategoryFromSupabaseIfConfigured(id);

      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, categories: updatedList }));
      return;
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: err?.message || 'Server error deleting category' }));
      return;
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: `Method ${method} not allowed` }));
}
