import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface CategoryItem {
  id: string;
  name: string;
  imageUrl?: string;
}

const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: 'cat-1', name: 'Rice & Grains', imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-2', name: 'Pulses & Dal', imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-3', name: 'Flour & Atta', imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-4', name: 'Oil & Ghee', imageUrl: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-5', name: 'Spices & Masala', imageUrl: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-6', name: 'Snacks & Packaged Foods', imageUrl: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281699?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-7', name: 'Fasting foods', imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-8', name: 'Beverages', imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-9', name: 'Dry fruits', imageUrl: 'https://images.unsplash.com/photo-1599599810769-bcde5a160d32?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-10', name: 'Dairy Products', imageUrl: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-11', name: 'Personal Care', imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-12', name: 'Cleaning & Household', imageUrl: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-13', name: 'Pooja Needs', imageUrl: 'https://images.unsplash.com/photo-1609137144813-7d9921338f24?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-14', name: 'Ayurvedic Products', imageUrl: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=400&q=80' },
  { id: 'cat-15', name: 'Other Grocery Items', imageUrl: 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?auto=format&fit=crop&w=400&q=80' },
];

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-anon-key') {
    try {
      return createClient(url, key, { auth: { persistSession: false } });
    } catch {
      return null;
    }
  }
  return null;
}

export function loadCategoriesFromFile(): CategoryItem[] {
  try {
    if (fs.existsSync(CATEGORIES_FILE)) {
      const content = fs.readFileSync(CATEGORIES_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.error('Failed to read categories.json:', err);
  }

  // If no file exists yet, seed with defaults
  saveCategoriesToFile(DEFAULT_CATEGORIES);
  return DEFAULT_CATEGORIES;
}

export async function loadCategories(): Promise<CategoryItem[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.from('categories').select('id, name, image_url');
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((row) => ({
          id: String(row.id),
          name: String(row.name || '').trim(),
          imageUrl: (row.image_url && String(row.image_url).trim()) || '',
        }));
      }
    } catch {
      // Non-fatal if categories table is not provisioned
    }
  }
  return loadCategoriesFromFile();
}

export function saveCategoriesToFile(categories: CategoryItem[]): void {
  try {
    const tempFile = `${CATEGORIES_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(categories, null, 2), 'utf8');
    fs.renameSync(tempFile, CATEGORIES_FILE);
  } catch (err) {
    console.error('Failed to write categories.json:', err);
  }
}

async function syncCategoryToSupabaseIfConfigured(category: CategoryItem): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase.from('categories').upsert(
      {
        id: category.id,
        name: category.name.trim(),
        image_url: category.imageUrl && category.imageUrl.trim() ? category.imageUrl.trim() : null,
      },
      { onConflict: 'id' }
    );
    if (error && !error.message?.includes('schema cache')) {
      console.warn('Supabase categories table upsert note:', error.message);
    }
  } catch {
    // Non-fatal if table is not provisioned
  }
}

async function deleteCategoryFromSupabaseIfConfigured(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase.from('categories').delete().eq('id', id);
  } catch {
    // Non-fatal
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
      const current = loadCategoriesFromFile();

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
        const validatedCategories: CategoryItem[] = body.categories.map((c: any) => ({
          id: String(c.id || `cat-${Date.now()}`),
          name: String(c.name || '').trim(),
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() : '',
        })).filter((c: CategoryItem) => c.name.length > 0);

        saveCategoriesToFile(validatedCategories);
        for (const cat of validatedCategories) {
          syncCategoryToSupabaseIfConfigured(cat).catch(() => {});
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
      const updatedItem: CategoryItem = {
        id: categoryId,
        name: String(catData.name).trim(),
        imageUrl: catData.imageUrl ? String(catData.imageUrl).trim() : '',
      };

      const existingIndex = current.findIndex((c) => c.id === categoryId);
      const oldImageUrl = existingIndex >= 0 ? current[existingIndex].imageUrl : undefined;
      let updatedList: CategoryItem[];

      if (existingIndex >= 0) {
        updatedList = [...current];
        updatedList[existingIndex] = updatedItem;
      } else {
        updatedList = [...current, updatedItem];
      }

      saveCategoriesToFile(updatedList);
      syncCategoryToSupabaseIfConfigured(updatedItem).catch(() => {});

      // Safe cleanup of replaced photo ONLY after successful category save
      if (oldImageUrl && oldImageUrl !== updatedItem.imageUrl) {
        safelyDeleteOldStorageImage(oldImageUrl, updatedItem.imageUrl, updatedList, categoryId).catch(() => {});
      }

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

      const current = loadCategoriesFromFile();
      const target = current.find((c) => c.id === id);
      const updatedList = current.filter((c) => c.id !== id);
      saveCategoriesToFile(updatedList);
      deleteCategoryFromSupabaseIfConfigured(id).catch(() => {});

      // Safely cleanup old storage image if target category had one
      if (target?.imageUrl) {
        safelyDeleteOldStorageImage(target.imageUrl, undefined, updatedList, id).catch(() => {});
      }

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
