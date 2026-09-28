import { supabase } from './supabase';
import { Category } from '../types';
import { INITIAL_CATEGORIES } from '../data/seedData';

/**
 * Fetches all categories from Supabase.
 * In the live Supabase database schema, categories are maintained via the existing products catalog.
 * Returns null if Supabase is unavailable or query fails.
 */
export async function fetchCategoriesFromDb(): Promise<Category[] | null> {
  if (!supabase) return null;

  try {
    // Access categories from the existing products catalog in Supabase
    const { data: prodData, error: prodError } = await supabase
      .from('products')
      .select('category, image_url')
      .not('category', 'is', null);

    if (prodError) {
      return null;
    }

    if (!prodData || prodData.length === 0) {
      return INITIAL_CATEGORIES;
    }

    const initialMap = new Map<string, Category>();
    INITIAL_CATEGORIES.forEach((c) => {
      initialMap.set(c.name.trim().toLowerCase(), c);
      initialMap.set(c.id.toLowerCase(), c);
    });

    const categoryMap = new Map<string, Category>();

    prodData.forEach((row: { category: string; image_url?: string | null }) => {
      const catName = (row.category || '').trim();
      if (!catName) return;
      const key = catName.toLowerCase();
      if (!categoryMap.has(key)) {
        const matched = initialMap.get(key);
        categoryMap.set(key, {
          id: matched ? matched.id : `cat-${catName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          name: matched ? matched.name : catName,
          imageUrl: (row.image_url && String(row.image_url).trim()) || (matched ? matched.imageUrl : '') || '',
        });
      }
    });

    // Ensure all standard baseline categories are preserved
    INITIAL_CATEGORIES.forEach((ic) => {
      const key = ic.name.trim().toLowerCase();
      if (!categoryMap.has(key)) {
        categoryMap.set(key, ic);
      }
    });

    return Array.from(categoryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    return null;
  }
}

/**
 * Saves or updates a category in Supabase.
 * Safe fallback if public.categories table is not in the schema cache.
 */
export async function saveCategoryToDb(
  category: Category
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: true }; // Local-first fallback
  }

  try {
    // If public.categories table is present, upsert to it safely
    const { error } = await supabase.from('categories').upsert(
      {
        id: category.id,
        name: category.name.trim(),
        image_url: category.imageUrl && category.imageUrl.trim() ? category.imageUrl.trim() : null,
      },
      { onConflict: 'id' }
    );

    if (error) {
      if (!error.message?.includes('schema cache')) {
        console.warn('Failed to upsert category in Supabase:', error.message);
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (err: any) {
    if (!err?.message?.includes('schema cache')) {
      console.warn('Error saving category to Supabase:', err);
    }
    return { success: true };
  }
}

/**
 * Deletes a category from Supabase.
 * Safe fallback if public.categories table is not in the schema cache.
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
      if (!error.message?.includes('schema cache')) {
        console.warn('Failed to delete category in Supabase:', error.message);
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (err: any) {
    if (!err?.message?.includes('schema cache')) {
      console.warn('Error deleting category from Supabase:', err);
    }
    return { success: true };
  }
}

