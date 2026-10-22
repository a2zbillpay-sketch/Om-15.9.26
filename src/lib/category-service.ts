import { supabase } from './supabase';
import { Category } from '../types';
import { INITIAL_CATEGORIES } from '../data/seedData';

/**
 * Fetches all categories.
 * Primary: /api/categories (persistent server storage).
 * Secondary: Supabase public.categories table if provisioned.
 * Fallback: Baseline INITIAL_CATEGORIES.
 */
export async function fetchCategoriesFromDb(): Promise<Category[] | null> {
  // 1. Primary: Fetch from persistent server API endpoint
  try {
    const res = await fetch('/api/categories', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.categories) && data.categories.length > 0) {
        const serverCats: Category[] = data.categories.map((c: any) => ({
          id: String(c.id),
          name: String(c.name || '').trim(),
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() : '',
        }));

        // Check if client has local customizations in localStorage that should be preserved & synced to server
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            const localRaw = localStorage.getItem('om_categories');
            if (localRaw) {
              const localParsed: Category[] = JSON.parse(localRaw);
              if (Array.isArray(localParsed) && localParsed.length > 0) {
                const hasLocalCustomizations = localParsed.some((loc) => {
                  const srv = serverCats.find((s) => s.id === loc.id);
                  return srv && (srv.name !== loc.name || srv.imageUrl !== loc.imageUrl);
                });

                const serverHasCustomizations = serverCats.some((srv) => {
                  const init = INITIAL_CATEGORIES.find((i) => i.id === srv.id);
                  return !init || init.name !== srv.name || init.imageUrl !== srv.imageUrl;
                });

                if (hasLocalCustomizations && !serverHasCustomizations) {
                  // Push local customizations to server
                  fetch('/api/categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ categories: localParsed }),
                  }).catch(() => {});
                  return localParsed;
                }
              }
            }
          } catch {
            // ignore
          }
        }

        return serverCats;
      }
    }
  } catch (err) {
    console.warn('Notice: /api/categories fetch exception (trying secondary storage):', err);
  }

  // 2. Secondary: If Supabase is configured and has public.categories table
  if (supabase) {
    try {
      const { data: catData, error: catError } = await supabase
        .from('categories')
        .select('id, name, image_url');

      if (!catError && Array.isArray(catData) && catData.length > 0) {
        const dbCategories: Category[] = catData.map((row) => ({
          id: row.id,
          name: row.name,
          imageUrl: (row.image_url && String(row.image_url).trim()) || '',
        }));

        return dbCategories;
      }
    } catch {
      // Non-fatal
    }
  }

  // 3. Fallback: Baseline seed categories
  return INITIAL_CATEGORIES;
}

/**
 * Saves or updates a category in persistent server storage and Supabase.
 */
export async function saveCategoryToDb(
  category: Category
): Promise<{ success: boolean; error?: string; category?: Category }> {
  // 1. Primary: Persist to /api/categories server endpoint
  try {
    const res = await fetch('/api/categories', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ category }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.category) {
        // Also update localStorage immediately for instant offline/PWA cache
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            const raw = localStorage.getItem('om_categories');
            if (raw) {
              const current: Category[] = JSON.parse(raw);
              if (Array.isArray(current)) {
                const updated = current.map((c) => (c.id === category.id ? category : c));
                localStorage.setItem('om_categories', JSON.stringify(updated));
              }
            }
          } catch {}
        }
        return { success: true, category: data.category };
      }
      return { success: false, error: data?.error || 'Failed to save category.' };
    }

    const errorJson = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errorJson?.error || `Server responded with status ${res.status}. Please ensure you are logged in.`,
    };
  } catch (err: any) {
    console.warn('Failed to save category to /api/categories:', err);
    return { success: false, error: err?.message || 'Network error saving category.' };
  }
}

/**
 * Deletes a category from server storage and Supabase.
 */
export async function deleteCategoryFromDb(
  id: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Delete from server API
  try {
    const res = await fetch(`/api/categories?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        return { success: true };
      }
      return { success: false, error: data?.error || 'Failed to delete category.' };
    }

    const errorJson = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errorJson?.error || `Server responded with status ${res.status}. Please ensure you are logged in.`,
    };
  } catch (err: any) {
    console.warn('Failed to delete category from /api/categories:', err);
    return { success: false, error: err?.message || 'Network error deleting category.' };
  }
}
