import { supabase } from './supabase';
import { Category } from '../types';
import { INITIAL_CATEGORIES } from '../data/seedData';

/**
 * Fetches all categories.
 * Primary: Supabase public.categories table (authoritative source of truth).
 * Secondary: /api/categories server endpoint & local cache.
 * Fallback: Baseline INITIAL_CATEGORIES.
 */
export async function fetchCategoriesFromDb(): Promise<Category[] | null> {
  // 1. Primary: Direct query to Supabase public.categories table
  if (supabase) {
    try {
      const { data: catData, error: catError } = await supabase
        .from('categories')
        .select('id, name, image_url, display_order')
        .order('display_order', { ascending: true });

      if (!catError && Array.isArray(catData) && catData.length > 0) {
        const dbCategories: Category[] = catData.map((row, idx: number) => ({
          id: String(row.id),
          name: String(row.name || '').trim(),
          imageUrl: (row.image_url && String(row.image_url).trim()) || '',
          displayOrder: typeof row.display_order === 'number' ? row.display_order : (idx + 1),
        }));

        dbCategories.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

        // Sync with localStorage for instantaneous offline / PWA access
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.setItem('om_categories', JSON.stringify(dbCategories));
          } catch {}
        }

        return dbCategories;
      }
    } catch (err) {
      // Non-fatal if Supabase quota is exceeded or network transient
      console.warn('Notice: Supabase categories query notice (falling back to server endpoint):', err);
    }
  }

  // 2. Secondary: Fetch from persistent server API endpoint
  try {
    const res = await fetch('/api/categories', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.categories) && data.categories.length > 0) {
        const serverCats: Category[] = data.categories.map((c: any, idx: number) => ({
          id: String(c.id),
          name: String(c.name || '').trim(),
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() : '',
          displayOrder: typeof c.display_order === 'number' ? c.display_order : (typeof c.displayOrder === 'number' ? c.displayOrder : idx + 1),
        }));

        serverCats.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.setItem('om_categories', JSON.stringify(serverCats));
          } catch {}
        }

        return serverCats;
      }
    }
  } catch (err) {
    console.warn('Notice: /api/categories fetch exception:', err);
  }

  // 3. Fallback: LocalStorage cache
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const localRaw = localStorage.getItem('om_categories');
      if (localRaw) {
        const localParsed = JSON.parse(localRaw);
        if (Array.isArray(localParsed) && localParsed.length > 0) {
          return localParsed;
        }
      }
    } catch {}
  }

  // 4. Ultimate Fallback: Baseline seed categories
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

/**
 * Persists the reordered list of categories with updated display orders to server & Supabase.
 */
export async function reorderCategoriesInDb(
  categories: Category[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ categories }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.setItem('om_categories', JSON.stringify(categories));
          } catch {}
        }
        return { success: true };
      }
      return { success: false, error: data?.error || 'Failed to reorder categories.' };
    }

    const errorJson = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errorJson?.error || `Server responded with status ${res.status}`,
    };
  } catch (err: any) {
    console.warn('Failed to reorder categories:', err);
    return { success: false, error: err?.message || 'Network error reordering categories.' };
  }
}
