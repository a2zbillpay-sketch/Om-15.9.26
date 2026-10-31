import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Category } from '../types';
import { uploadCategoryImageToStorage, validateImageFile } from '../lib/image-service';
import {
  Plus,
  Edit2,
  Trash2,
  Upload,
  X,
  Check,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  FolderPlus,
  FolderTree,
  Search,
  Image as ImageIcon,
  Loader2,
  Package,
} from 'lucide-react';

export const CategoryManagement: React.FC = () => {
  const { categories, addCategory, updateCategory, deleteCategory, reorderCategories, products } =
    useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  // Form states for Add / Edit
  const [formData, setFormData] = useState<{
    name: string;
    imageUrl: string;
  }>({
    name: '',
    imageUrl: '',
  });

  const [imagePreview, setImagePreview] = useState<string>('');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter categories by search query
  const filteredCategories = categories.filter((cat) =>
    cat.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const handleOpenAddModal = () => {
    setFormData({ name: '', imageUrl: '' });
    setImagePreview('');
    setUploadError(null);
    setActionError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setFormData({ name: cat.name, imageUrl: cat.imageUrl || '' });
    setImagePreview(cat.imageUrl || '');
    setUploadError(null);
    setActionError(null);
  };

  // Handle Photo selection and upload to Supabase Storage ('product-images/categories/')
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // 1. Validate file format and size
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid file format');
      return;
    }

    // 2. Set instant local preview
    const localUrl = URL.createObjectURL(file);
    setImagePreview(localUrl);
    setIsUploadingPhoto(true);

    try {
      // 3. Upload to 'product-images/categories/'
      const res = await uploadCategoryImageToStorage(file, file.name);
      if (res.success && res.url) {
        setFormData((prev) => ({ ...prev, imageUrl: res.url! }));
        setImagePreview(res.url);
      } else {
        setUploadError(res.error || 'Failed to upload photo to cloud storage.');
      }
    } catch (err: any) {
      setUploadError(err?.message || 'Error uploading photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    setFormData((prev) => ({ ...prev, imageUrl: '' }));
    setImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submit Add Category
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formData.name.trim();
    if (!cleanName) {
      setActionError('Category name is required (कॅटेगरीचे नाव आवश्यक आहे).');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const res = await addCategory({
        name: cleanName,
        imageUrl: formData.imageUrl.trim() || undefined,
      });

      if (res.success) {
        setIsAddModalOpen(false);
        setFormData({ name: '', imageUrl: '' });
        setImagePreview('');
      } else {
        setActionError(res.error || 'Failed to create category.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error creating category.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Edit Category
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;

    const cleanName = formData.name.trim();
    if (!cleanName) {
      setActionError('Category name is required.');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const res = await updateCategory(editingCategory.id, {
        name: cleanName,
        imageUrl: formData.imageUrl.trim(),
      });

      if (res.success) {
        setEditingCategory(null);
        setFormData({ name: '', imageUrl: '' });
        setImagePreview('');
      } else {
        setActionError(res.error || 'Failed to update category.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error updating category.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Delete Category
  const handleDeleteConfirm = async () => {
    if (!deletingCategory) return;
    setIsSubmitting(true);
    setActionError(null);

    try {
      const res = await deleteCategory(deletingCategory.id);
      if (res.success) {
        setDeletingCategory(null);
      } else {
        setActionError(res.error || 'Failed to delete category.');
      }
    } catch (err: any) {
      setActionError(err?.message || 'Server error deleting category.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reorder: Move Up
  const handleMoveUp = async (index: number) => {
    if (index <= 0) return;
    const updated = [...categories];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    await reorderCategories(updated);
  };

  // Reorder: Move Down
  const handleMoveDown = async (index: number) => {
    if (index >= categories.length - 1) return;
    const updated = [...categories];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    await reorderCategories(updated);
  };

  // Count products currently mapped to a category
  const getProductCountForCategory = (catId: string) => {
    return products.filter((p) => p.categoryId === catId).length;
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-[#0F2C59] text-[#D4AF37] flex items-center justify-center font-black shadow-xs">
                <FolderTree size={18} />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#0F2C59] flex items-center gap-2">
                  <span>Category Management</span>
                  <span className="text-xs bg-[#0F2C59]/10 text-[#0F2C59] px-2 py-0.5 rounded-full font-bold">
                    {categories.length} {categories.length === 1 ? 'Category' : 'Categories'}
                  </span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  कॅटेगरी व्यवस्थापन — नवीन कॅटेगरी जोडा, नाव व फोटो बदला आणि क्रम नियंत्रित करा
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              id="btn-add-category"
              onClick={handleOpenAddModal}
              className="bg-[#0F2C59] hover:bg-[#163a6e] text-white px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 shadow-xs transition active:scale-95 cursor-pointer shrink-0"
            >
              <Plus size={15} className="text-[#D4AF37]" />
              <span>+ Add New Category</span>
            </button>
          </div>
        </div>

        {/* Search bar when categories exist */}
        {categories.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search categories by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-gray-200 rounded-xl focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="text-xs text-gray-500 font-medium">
              Showing {filteredCategories.length} of {categories.length}
            </div>
          </div>
        )}
      </div>

      {/* Empty State: Zero Categories Created */}
      {categories.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 sm:p-14 text-center border-2 border-dashed border-gray-200 max-w-xl mx-auto my-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-700 mx-auto flex items-center justify-center mb-4 border border-amber-200 shadow-xs">
            <FolderPlus size={32} />
          </div>
          <h3 className="text-base font-black text-gray-900">कोणतीही कॅटेगरी तयार केलेली नाही</h3>
          <p className="text-xs text-gray-500 font-medium mt-1 mb-2">No Categories Created Yet</p>
          <p className="text-xs text-gray-600 max-w-md mx-auto leading-relaxed mb-6">
            तुम्ही स्वतः कॅटेगरीचे नाव व संबंधित फोटो निवडून नवीन कॅटेगरी जोडू शकता. कॅटेगरी तयार होईपर्यंत
            Customer Store मध्ये सर्व प्रॉडक्ट्स सुरळीत दिसतील.
          </p>
          <button
            type="button"
            id="btn-add-first-category"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 bg-[#0F2C59] hover:bg-[#163a6e] text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-md transition active:scale-95 cursor-pointer"
          >
            <Plus size={16} className="text-[#D4AF37]" />
            <span>+ Create First Category (+ नवीन कॅटेगरी जोडा)</span>
          </button>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-gray-200 max-w-md mx-auto">
          <p className="text-xs text-gray-500 font-bold">"{searchQuery}" शी जुळणारी कोणतीही कॅटेगरी सापडली नाही.</p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="mt-2 text-xs font-bold text-[#0F2C59] hover:underline"
          >
            सर्व कॅटेगरीज दाखवा (Show all)
          </button>
        </div>
      ) : (
        /* Categories List / Cards */
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="divide-y divide-gray-100">
            {filteredCategories.map((cat, index) => {
              const productCount = getProductCountForCategory(cat.id);
              const realIndex = categories.findIndex((c) => c.id === cat.id);

              return (
                <div
                  key={cat.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50/80 transition"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Reorder Buttons (Move Up / Down) */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMoveUp(realIndex)}
                        disabled={realIndex === 0}
                        title="Move Up (वर घ्या)"
                        className="p-1 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-gray-100 text-gray-700 transition cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(realIndex)}
                        disabled={realIndex === categories.length - 1}
                        title="Move Down (खाली घ्या)"
                        className="p-1 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-gray-100 text-gray-700 transition cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>

                    {/* Order Index Badge */}
                    <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-[11px] font-black shrink-0">
                      #{realIndex + 1}
                    </div>

                    {/* Category Photo Thumbnail */}
                    <div className="w-12 h-12 rounded-xl border border-gray-200 overflow-hidden bg-gray-50 shrink-0 flex items-center justify-center">
                      {cat.imageUrl ? (
                        <img
                          src={cat.imageUrl}
                          alt={cat.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                          <ImageIcon size={18} />
                        </div>
                      )}
                    </div>

                    {/* Category Name & Details */}
                    <div className="min-w-0">
                      <h4 className="text-sm font-black text-gray-900 truncate flex items-center gap-2">
                        <span>{cat.name}</span>
                      </h4>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                        <span className="flex items-center gap-1 font-semibold text-gray-700">
                          <Package size={12} className="text-gray-400" />
                          <span>
                            {productCount} {productCount === 1 ? 'Product' : 'Products'}
                          </span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[10px] text-gray-400 truncate max-w-[120px]">
                          ID: {cat.id}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons: Edit, Delete */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(cat)}
                      className="px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                      title="Edit Category Name & Photo"
                    >
                      <Edit2 size={13} className="text-[#0F2C59]" />
                      <span>Edit (बदला)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setDeletingCategory(cat);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                      title="Delete Category"
                    >
                      <Trash2 size={13} className="text-rose-600" />
                      <span>Delete (हटवा)</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: Add Category Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-[#0F2C59] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderPlus size={18} className="text-[#D4AF37]" />
                <h3 className="font-black text-sm">Add New Category (नवीन कॅटेगरी जोडा)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-5 space-y-4">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Category Name */}
              <div>
                <label className="text-xs font-black text-gray-800 block mb-1">
                  Category Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="उदा. किराणा, कडधान्ये, तेल/तूप, मसाले..."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2.5 text-xs border border-gray-300 rounded-xl focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none font-bold"
                  autoFocus
                />
              </div>

              {/* Photo Upload: Stored in product-images/categories/ */}
              <div>
                <label className="text-xs font-black text-gray-800 block mb-1">
                  Category Photo <span className="text-xs text-gray-400 font-normal">(Optional / ऐच्छिक)</span>
                </label>

                {imagePreview ? (
                  <div className="relative w-24 h-24 rounded-xl border border-gray-200 overflow-hidden bg-gray-50 group">
                    <img
                      src={imagePreview}
                      alt="Category preview"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="absolute top-1 right-1 p-1 rounded-full bg-rose-600 text-white hover:bg-rose-700 shadow-xs transition"
                      title="Remove Photo"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 hover:border-[#0F2C59] rounded-xl p-4 text-center cursor-pointer transition bg-gray-50 hover:bg-white"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    {isUploadingPhoto ? (
                      <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                        <Loader2 size={20} className="animate-spin text-[#0F2C59]" />
                        <span className="text-xs font-bold text-gray-700">Uploading to cloud storage...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <Upload size={18} className="text-gray-400" />
                        <span className="text-xs font-bold text-gray-700">फोटो निवडा (Upload Photo)</span>
                        <span className="text-[10px] text-gray-400">JPG, PNG, WebP (Max 15MB)</span>
                      </div>
                    )}
                  </div>
                )}

                {uploadError && <p className="text-[11px] font-bold text-rose-600 mt-1.5">{uploadError}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  फोटो आपोआप 'product-images/categories/' क्लाउड फोल्डरमध्ये सुरक्षित सेव्ह होतो.
                </p>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold transition cursor-pointer"
                >
                  Cancel (रद्द करा)
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isUploadingPhoto}
                  className="px-5 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] disabled:opacity-60 text-white text-xs font-black shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                  <span>Save Category (सेव्ह करा)</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-[#0F2C59] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 size={18} className="text-[#D4AF37]" />
                <h3 className="font-black text-sm">Edit Category (कॅटेगरी संपादित करा)</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Category Name */}
              <div>
                <label className="text-xs font-black text-gray-800 block mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2.5 text-xs border border-gray-300 rounded-xl focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none font-bold"
                  autoFocus
                />
              </div>

              {/* Photo Upload: Stored in product-images/categories/ */}
              <div>
                <label className="text-xs font-black text-gray-800 block mb-1">Category Photo</label>

                {imagePreview ? (
                  <div className="relative w-24 h-24 rounded-xl border border-gray-200 overflow-hidden bg-gray-50 group">
                    <img
                      src={imagePreview}
                      alt="Category preview"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="absolute top-1 right-1 p-1 rounded-full bg-rose-600 text-white hover:bg-rose-700 shadow-xs transition"
                      title="Remove Photo"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 hover:border-[#0F2C59] rounded-xl p-4 text-center cursor-pointer transition bg-gray-50 hover:bg-white"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    {isUploadingPhoto ? (
                      <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                        <Loader2 size={20} className="animate-spin text-[#0F2C59]" />
                        <span className="text-xs font-bold text-gray-700">Uploading photo...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <Upload size={18} className="text-gray-400" />
                        <span className="text-xs font-bold text-gray-700">नवीन फोटो निवडा (Change Photo)</span>
                        <span className="text-[10px] text-gray-400">JPG, PNG, WebP</span>
                      </div>
                    )}
                  </div>
                )}

                {uploadError && <p className="text-[11px] font-bold text-rose-600 mt-1.5">{uploadError}</p>}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isUploadingPhoto}
                  className="px-5 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] disabled:opacity-60 text-white text-xs font-black shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                  <span>Update Category (बदल सेव्ह करा)</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Safe Delete Confirmation Modal */}
      {deletingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-gray-200 overflow-hidden">
            <div className="bg-rose-700 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={18} />
                <h3 className="font-black text-sm">Delete Category (कॅटेगरी हटवा)</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingCategory(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-gray-200 hover:text-white transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="w-12 h-12 rounded-lg border border-gray-200 overflow-hidden bg-white shrink-0 flex items-center justify-center">
                  {deletingCategory.imageUrl ? (
                    <img
                      src={deletingCategory.imageUrl}
                      alt={deletingCategory.name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <FolderTree size={20} className="text-gray-400" />
                  )}
                </div>
                <div>
                  <h4 className="font-black text-sm text-gray-900">{deletingCategory.name}</h4>
                  <p className="text-[11px] text-gray-500">
                    {getProductCountForCategory(deletingCategory.id)} products linked
                  </p>
                </div>
              </div>

              {getProductCountForCategory(deletingCategory.id) > 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-700 shrink-0" />
                    <span>डेटा सुरक्षा सूचना (Data Safety Notice):</span>
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    या कॅटेगरीमध्ये सध्या <strong>{getProductCountForCategory(deletingCategory.id)} प्रॉडक्ट्स</strong>{' '}
                    आहेत. ही कॅटेगरी हटवल्यास प्रॉडक्ट्स, त्यांचे व्हेरियंट्स, किमती, स्टॉक आणि बारकोड{' '}
                    <strong>१००% सुरक्षित राहतील</strong>. फक्त त्यांचे कॅटेगरी वर्गीकरण मोकळे होईल.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-600 leading-relaxed">
                  तुम्हाला नक्की ही कॅटेगरी हटवायची आहे का? ही क्रिया पूर्ववत करता येणार नाही.
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setDeletingCategory(null)}
                  className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 text-gray-700 text-xs font-bold transition cursor-pointer"
                >
                  Cancel (रद्द करा)
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white text-xs font-black shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} />}
                  <span>Confirm Delete (कॅटेगरी हटवा)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
