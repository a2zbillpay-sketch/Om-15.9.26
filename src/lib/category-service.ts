import { Category } from '../types';

/**
 * Phase 2B: Clean Dynamic Category Service.
 * - Zero default or sample categories.
 * - Fetches live categories from Supabase via /api/categories.
 * - Mutates categories with Shopkeeper admin session authentication.
 */
export async function fetchCategoriesFromDb(): Promise<Category[]> {
  try {
    const res = await fetch('/api/categories', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.categories)) {
        return data.categories
          .map((c: any, idx: number) => ({
            id: String(c.id),
            name: String(c.name || '').trim(),
            imageUrl: c.imageUrl ? String(c.imageUrl).trim() : '',
            displayOrder:
              typeof c.display_order === 'number'
                ? c.display_order
                : typeof c.displayOrder === 'number'
                ? c.displayOrder
                : idx + 1,
          }))
          .filter((c: Category) => c.name.length > 0);
      }
    }
  } catch (err) {
    console.warn('Notice: categories fetch non-fatal:', err);
  }
  return [];
}

export async function saveCategoryToDb(
  category: Category
): Promise<{ success: boolean; error?: string; category?: Category }> {
  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      const saved = data.category || category;
      return {
        success: true,
        category: {
          id: String(saved.id),
          name: String(saved.name),
          imageUrl: saved.imageUrl ? String(saved.imageUrl) : '',
          displayOrder:
            typeof saved.display_order === 'number'
              ? saved.display_order
              : typeof saved.displayOrder === 'number'
              ? saved.displayOrder
              : category.displayOrder,
        },
      };
    }
    return { success: false, error: data.error || 'Failed to save category' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error saving category' };
  }
}

export async function deleteCategoryFromDb(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/categories?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Failed to delete category' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error deleting category' };
  }
}

export async function reorderCategoriesInDb(
  categories: Category[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ categories }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      return { success: true };
    }
    return { success: false, error: data.error || 'Failed to reorder categories' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error reordering categories' };
  }
}
