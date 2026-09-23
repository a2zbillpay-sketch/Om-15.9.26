import React, { useState, useMemo } from 'react';
import {
  Tag,
  Plus,
  Edit2,
  Trash2,
  Search,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  X,
  Layers,
  Package,
  ZoomIn,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Category } from '../types';
import { ImageLightboxModal } from './ImageLightboxModal';
import { ProductImageUploader } from './ProductImageUploader';

interface CategoryFormData {
  name: string;
  imageUrl: string;
}

const CategoryPhotoThumbnail: React.FC<{
  imageUrl?: string;
  name: string;
  onZoom: () => void;
}> = ({ imageUrl, name, onZoom }) => {
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || !imageUrl.trim() || hasError) {
    return (
      <div className="w-16 h-16 rounded-xl bg-orange-50 border border-orange-100 shrink-0 flex flex-col items-center justify-center text-[#FF6B00]">
        <Tag size={22} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onZoom}
      className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0 cursor-pointer group/thumb focus:outline-hidden"
      title={`Click to preview full photo of ${name}`}
      aria-label={`View photo of ${name}`}
    >
      <img
        src={imageUrl}
        alt={name}
        onError={() => setHasError(true)}
        className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
        loading="lazy"
      />
      <span className="absolute inset-0 bg-black/25 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center text-white transition-opacity">
        <ZoomIn size={14} />
      </span>
    </button>
  );
};

export const CategoryManagement: React.FC = () => {
  const { categories, products, addCategory, updateCategory, deleteCategory } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Form state for Add/Edit
  const [formData, setFormData] = useState<CategoryFormData>({ name: '', imageUrl: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete dialog state
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Feedback notification
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Lightbox preview for category images
  const [zoomImage, setZoomImage] = useState<{ url: string; title: string } | null>(null);

  // Calculate product count per category
  const productCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      if (p.categoryId) {
        map.set(p.categoryId, (map.get(p.categoryId) || 0) + 1);
      }
    }
    return map;
  }, [products]);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((cat) => cat.name.toLowerCase().includes(query));
  }, [categories, searchQuery]);

  // Handle open Add modal
  const handleOpenAddModal = () => {
    setFormData({ name: '', imageUrl: '' });
    setFormError(null);
    setIsAddModalOpen(true);
  };

  // Handle open Edit modal
  const handleOpenEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setFormData({ name: cat.name, imageUrl: cat.imageUrl || '' });
    setFormError(null);
  };

  // Close modals
  const handleCloseFormModal = () => {
    setIsAddModalOpen(false);
    setEditingCategory(null);
    setFormData({ name: '', imageUrl: '' });
    setFormError(null);
  };

  // Handle Add/Edit submit
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      setFormError('Category name cannot be empty.');
      return;
    }

    // Case-insensitive duplicate check
    if (editingCategory) {
      const isDuplicate = categories.some(
        (c) => c.id !== editingCategory.id && c.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (isDuplicate) {
        setFormError(`A category named "${trimmedName}" already exists.`);
        return;
      }
    } else {
      const isDuplicate = categories.some(
        (c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (isDuplicate) {
        setFormError(`A category named "${trimmedName}" already exists.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (editingCategory) {
        const result = await updateCategory(editingCategory.id, {
          name: trimmedName,
          imageUrl: formData.imageUrl.trim(),
        });
        if (!result.success) {
          setFormError(result.error || 'Failed to update category.');
          setIsSubmitting(false);
          return;
        }
        setSuccessMessage(`Category "${trimmedName}" updated successfully.`);
      } else {
        const result = await addCategory({
          name: trimmedName,
          imageUrl: formData.imageUrl.trim(),
        });
        if (!result.success) {
          setFormError(result.error || 'Failed to add category.');
          setIsSubmitting(false);
          return;
        }
        setSuccessMessage(`Category "${trimmedName}" created successfully.`);
      }

      handleCloseFormModal();
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err: any) {
      setFormError(err?.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Delete Confirmation Click
  const handleInitiateDelete = (cat: Category) => {
    setCategoryToDelete(cat);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!categoryToDelete) return;

    const assignedCount = productCountMap.get(categoryToDelete.id) || 0;
    if (assignedCount > 0) {
      setDeleteError(
        `Cannot delete "${categoryToDelete.name}". There are currently ${assignedCount} product(s) assigned to this category. Please reassign or delete those products first.`
      );
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteCategory(categoryToDelete.id);
      if (!result.success) {
        setDeleteError(result.error || 'Failed to delete category.');
        setIsDeleting(false);
        return;
      }
      setSuccessMessage(`Category "${categoryToDelete.name}" was deleted successfully.`);
      setCategoryToDelete(null);
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete category.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Success Notification Banner */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm px-4 py-3 rounded-2xl flex items-center justify-between shadow-xs animate-in fade-in duration-200">
          <span className="flex items-center gap-2 font-bold">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            {successMessage}
          </span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-900 p-1"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center text-[#FF6B00]">
              <Tag size={18} />
            </div>
            <div>
              <h2 className="text-base font-black text-[#0F2C59]">Category Management</h2>
              <p className="text-xs text-gray-500">
                Organize store catalog with categories ({categories.length} total)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Search bar */}
          <div className="relative flex-1 sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              id="category-search-input"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] bg-gray-50/50"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Add Category Button */}
          <button
            type="button"
            id="btn-add-category"
            onClick={handleOpenAddModal}
            className="bg-[#0F2C59] hover:bg-[#153e7d] text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow transition shrink-0 hover:scale-[1.02] active:scale-95"
          >
            <Plus size={14} className="text-[#D4AF37]" />
            <span>Add Category</span>
          </button>
        </div>
      </div>

      {/* Categories List / Grid */}
      {filteredCategories.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto text-gray-400 mb-3">
            <Tag size={24} />
          </div>
          <h3 className="text-sm font-bold text-gray-800 mb-1">
            {searchQuery ? 'No matching categories found' : 'No categories available'}
          </h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto mb-4">
            {searchQuery
              ? `No categories match "${searchQuery}". Try a different keyword.`
              : 'Add your first category to start organizing your product catalog.'}
          </p>
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="px-3 py-1.5 text-xs font-bold text-[#0F2C59] bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              Clear Search
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="px-4 py-2 text-xs font-bold text-white bg-[#0F2C59] rounded-xl hover:bg-[#153e7d] transition"
            >
              + Create Category
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filteredCategories.map((cat) => {
            const count = productCountMap.get(cat.id) || 0;
            const hasProducts = count > 0;

            return (
              <div
                key={cat.id}
                id={`category-card-${cat.id}`}
                className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex gap-3 items-center">
                    {/* Category Image Preview & Lightbox */}
                    <CategoryPhotoThumbnail
                      imageUrl={cat.imageUrl}
                      name={cat.name}
                      onZoom={() => {
                        if (cat.imageUrl && cat.imageUrl.trim()) {
                          setZoomImage({ url: cat.imageUrl, title: cat.name });
                        }
                      }}
                    />

                    {/* Category Title & Stats */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-[10px] font-mono text-gray-400 uppercase">
                          {cat.id}
                        </span>
                      </div>
                      <h3 className="font-extrabold text-sm text-gray-900 truncate" title={cat.name}>
                        {cat.name}
                      </h3>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 border ${
                            hasProducts
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}
                        >
                          <Package size={10} />
                          <span>{count} {count === 1 ? 'Product' : 'Products'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="mt-3.5 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-gray-400">
                    {hasProducts ? (
                      <span className="text-gray-500">In use</span>
                    ) : (
                      <span className="text-amber-600 font-semibold">Empty</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      id={`btn-edit-category-${cat.id}`}
                      onClick={() => handleOpenEditModal(cat)}
                      className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:text-[#0F2C59] hover:bg-gray-50 transition flex items-center gap-1 text-xs font-semibold"
                      title={`Edit ${cat.name}`}
                    >
                      <Edit2 size={13} />
                      <span className="text-[11px]">Edit</span>
                    </button>

                    <button
                      type="button"
                      id={`btn-delete-category-${cat.id}`}
                      onClick={() => handleInitiateDelete(cat)}
                      className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
                        hasProducts
                          ? 'border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50/50'
                          : 'border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300'
                      }`}
                      title={
                        hasProducts
                          ? `Cannot delete: ${count} product(s) assigned`
                          : `Delete ${cat.name}`
                      }
                    >
                      <Trash2 size={13} />
                      <span className="text-[11px]">Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ADD / EDIT CATEGORY MODAL */}
      {(isAddModalOpen || editingCategory) && (
        <div
          id="category-modal-backdrop"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseFormModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-modal-title"
            className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="bg-[#0F2C59] p-4 text-white flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Tag size={18} className="text-[#D4AF37]" />
                <h3 id="category-modal-title" className="font-extrabold text-sm sm:text-base text-white">
                  {editingCategory ? 'Edit Category' : 'Add New Category'}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseFormModal}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmitForm} className="p-5 space-y-4">
              {/* Form error alert */}
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl flex items-start gap-2">
                  <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Category Name Input */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                  Category Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="category-name-input"
                  required
                  autoFocus
                  placeholder="e.g. Spices & Masala, Dairy, Beverages"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    if (formError) setFormError(null);
                  }}
                  className="w-full p-2.5 text-sm font-medium border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] bg-white text-gray-900 placeholder:text-gray-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Unique name for the category. Cannot be blank or duplicate.
                </p>
              </div>

              {/* Category Photo Uploader */}
              <div className="pt-1">
                <ProductImageUploader
                  currentImageUrl={formData.imageUrl}
                  onImageChange={(newUrl) => setFormData((prev) => ({ ...prev, imageUrl: newUrl }))}
                  productName={formData.name || 'Category'}
                  label="Category Photo"
                  subLabel="(Optional, 1:1 Square)"
                  idPrefix="category"
                  storageFolder="categories"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCloseFormModal}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="btn-save-category"
                  disabled={isSubmitting}
                  className="bg-[#0F2C59] hover:bg-[#153e7d] text-white px-5 py-2 rounded-xl font-black text-xs shadow transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Saving...</span>
                  ) : editingCategory ? (
                    <span>Save Changes</span>
                  ) : (
                    <span>Add Category</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION DIALOG */}
      {categoryToDelete && (() => {
        const assignedCount = productCountMap.get(categoryToDelete.id) || 0;
        const hasAssignedProducts = assignedCount > 0;

        return (
          <div
            id="delete-category-modal-backdrop"
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDeleting) {
                setCategoryToDelete(null);
                setDeleteError(null);
              }
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              aria-describedby="delete-dialog-desc"
              className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl border border-gray-100 p-5 sm:p-6 animate-in fade-in zoom-in-95 duration-150"
            >
              {hasAssignedProducts ? (
                /* CASE A: Products assigned - Deletion Blocked */
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
                    <AlertTriangle size={26} />
                  </div>

                  <h3 id="delete-dialog-title" className="text-base font-black text-gray-900 mb-2">
                    Cannot Delete Category
                  </h3>

                  <p id="delete-dialog-desc" className="text-xs sm:text-sm text-gray-600 leading-relaxed mb-4">
                    Category <strong className="text-gray-900">"{categoryToDelete.name}"</strong> cannot be deleted because{' '}
                    <span className="font-extrabold text-red-600">
                      {assignedCount} {assignedCount === 1 ? 'product is' : 'products are'}
                    </span>{' '}
                    currently assigned to it.
                  </p>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 mb-5">
                    <strong>Required Action:</strong> Please reassign or delete the products in this category before attempting to delete it.
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      id="btn-close-cannot-delete"
                      onClick={() => {
                        setCategoryToDelete(null);
                        setDeleteError(null);
                      }}
                      className="bg-[#0F2C59] hover:bg-[#153e7d] text-white px-5 py-2.5 rounded-xl font-bold text-xs transition"
                    >
                      Understood
                    </button>
                  </div>
                </div>
              ) : (
                /* CASE B: 0 Products assigned - Confirm Delete */
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-4">
                    <Trash2 size={24} />
                  </div>

                  <h3 id="delete-dialog-title" className="text-base font-black text-gray-900 mb-2">
                    Delete Category?
                  </h3>

                  <p id="delete-dialog-desc" className="text-xs sm:text-sm text-gray-600 leading-relaxed mb-4">
                    Are you sure you want to delete category{' '}
                    <strong className="text-gray-900">"{categoryToDelete.name}"</strong>?
                    This action will permanently remove it from the system.
                  </p>

                  {deleteError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-xl mb-4 flex items-start gap-2">
                      <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                      <span>{deleteError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryToDelete(null);
                        setDeleteError(null);
                      }}
                      disabled={isDeleting}
                      className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      id="btn-confirm-delete-category"
                      onClick={handleConfirmDelete}
                      disabled={isDeleting}
                      className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl font-black text-xs shadow transition flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete Category'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Lightbox Modal for Category Photos */}
      <ImageLightboxModal
        isOpen={Boolean(zoomImage)}
        onClose={() => setZoomImage(null)}
        imageUrl={zoomImage?.url}
        title={zoomImage?.title}
        subtitle="Category Image"
      />
    </div>
  );
};
