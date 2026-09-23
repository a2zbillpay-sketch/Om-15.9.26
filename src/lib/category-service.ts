import { supabase } from './supabase';
import { Category } from '../types';

/**
 * Fetches all categories from Supabase public.categories table.
 * Returns null if Supabase is unavailable or table query fails.
 */
export async function fetchCategoriesFromDb(): Promise<Category[] | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, image_url, created_at')
      .order('name', { ascending: true });

    if (error) {
      console.warn('Supabase categories fetch error:', error.message);
      return null;
    }

    if (!data) return [];

    return data.map((row: { id: string; name: string; image_url?: string | null }) => ({
      id: row.id,
      name: row.name,
      imageUrl: row.image_url || '',
    }));
  } catch (err) {
    console.warn('Failed to fetch categories from database:', err);
    return null;
  }
}

/**
 * Saves or updates a category in Supabase public.categories table.
 */
export async function saveCategoryToDb(
  category: Category
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: true }; // Local-first fallback
  }

  try {
    const { error } = await supabase.from('categories').upsert(
      {
        id: category.id,
        name: category.name.trim(),
        image_url: category.imageUrl && category.imageUrl.trim() ? category.imageUrl.trim() : null,
      },
      { onConflict: 'id' }
    );

    if (error) {
      console.warn('Failed to upsert category in Supabase:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.warn('Error saving category to Supabase:', err);
    return { success: false, error: err?.message || 'Database error' };
  }
}

/**
 * Deletes a category from Supabase public.categories table.
 */
export async function deleteCategoryFromDb(
  id: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: true }; // Local-first fallback
  }

  try {
    const { error } = await supabase.from('categories').delete().eq('id', id);

    if (error) {
      console.warn('Failed to delete category in Supabase:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.warn('Error deleting category from Supabase:', err);
    return { success: false, error: err?.message || 'Database error' };
  }
}
