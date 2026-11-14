import React, { useState, useRef, useMemo } from 'react';
import {
  FolderTree,
  Plus,
  Edit2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Upload,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
  Image as ImageIcon,
  Search,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Category } from '../types';
import { uploadCategoryPhoto } from '../lib/image-service';

export const CategoryManagement: React.FC = () => {
  const {
    categories,
    products,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    refreshCategories,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [successToast, setSuccessToast] = useState('');

  // Delete Confirmation state
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reordering & syncing state
  const [isSyncing, setIsSyncing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedCategories = useMemo(() => {
    return [...(categories || [])].sort(
      (a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)
    );
  }, [categories]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return sortedCategories;
    const q = searchQuery.toLowerCase().trim();
    return sortedCategories.filter((c) => c.name.toLowerCase().includes(q));
  }, [sortedCategories, searchQuery]);

  // Count products linked to a category
  const getProductCountForCategory = (cat: Category): number => {
    const catIdLower = (cat.id || '').toLowerCase().trim();
    const catNameLower = (cat.name || '').toLowerCase().trim();

    return (products || []).filter((p) => {
      const pCat = (p.categoryId || '').toLowerCase().trim();
      return pCat === catIdLower || pCat === catNameLower;
    }).length;
  };

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(''), 3500);
  };

  const openAddModal = () => {
    setEditingCategory(null);
    setName('');
    setImageUrl('');
    setFormError('');
    setUploadError('');
    setIsModalOpen(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setName(cat.name);
    setImageUrl(cat.imageUrl || '');
    setFormError('');
    setUploadError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCategory(null);
    setName('');
    setImageUrl('');
    setFormError('');
    setUploadError('');
  };

  // Photo Upload Handler (strictly uploads to product-images/categories/)
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError('');

    try {
      const result = await uploadCategoryPhoto(file);
      if (result.success && result.url) {
        setImageUrl(result.url);
      } else {
        setUploadError(result.error || 'फोटो अपलोड करण्यात अडचण आली.');
      }
    } catch (err: any) {
      setUploadError(err?.message || 'फोटो अपलोड अयशस्वी.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Category चे नाव आवश्यक आहे.');
      return;
    }

    setIsSaving(true);
    setFormError('');

    try {
      if (editingCategory) {
        // Update existing category
        const res = await updateCategory(editingCategory.id, {
          name: trimmedName,
          imageUrl: imageUrl.trim(),
        });
        if (res.success) {
          showToast(`"${trimmedName}" Category यशस्वीरित्या अपडेट केली.`);
          closeModal();
        } else {
          setFormError(res.error || 'Category अपडेट करण्यात त्रुटी आली.');
        }
      } else {
        // Add new category
        const res = await addCategory({
          name: trimmedName,
          imageUrl: imageUrl.trim(),
        });
        if (res.success) {
          showToast(`"${trimmedName}" Category यशस्वीरित्या जोडली.`);
          closeModal();
        } else {
          setFormError(res.error || 'Category जोडण्यात त्रुटी आली.');
        }
      }
    } catch (err: any) {
      setFormError(err?.message || 'Category सेव्ह करताना त्रुटी आली.');
    } finally {
      setIsSaving(false);
    }
  };

  // Execute deletion after explicit user confirmation
  const handleConfirmDelete = async () => {
    if (!deletingCategory) return;
    setIsDeleting(true);

    try {
      const catName = deletingCategory.name;
      const res = await deleteCategory(deletingCategory.id);
      if (res.success) {
        showToast(`"${catName}" Category हटवण्यात आली.`);
        setDeletingCategory(null);
      } else {
        alert(res.error || 'Category हटवण्यात अडचण आली.');
      }
    } catch (err: any) {
      alert(err?.message || 'Category हटवण्यात त्रुटी आली.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Reorder category (Move Up / Down)
  const handleMove = async (index: number, direction: 'UP' | 'DOWN') => {
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedCategories.length) return;

    const updated = [...sortedCategories];
    const [movedItem] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, movedItem);

    const reordered = updated.map((cat, idx) => ({
      ...cat,
      displayOrder: idx + 1,
    }));

    await reorderCategories(reordered);
    showToast('Categories चा क्रम अपडेट करण्यात आला.');
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await refreshCategories();
      showToast('Cloud वरून Categories सिंक झाल्या.');
    } catch {
      showToast('सिंक करताना त्रुटी आली.');
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden w-full">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed top-5 right-5 z-50 bg-[#0F2C59] text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 border border-[#D4AF37]/50 text-xs font-bold animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={16} className="text-[#D4AF37]" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="p-4 sm:p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#0F2C59]/10 text-[#0F2C59] flex items-center justify-center font-bold">
              <FolderTree size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-[#0F2C59] flex items-center gap-2">
                <span>Category Management</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#0F2C59] text-[#D4AF37]">
                  {sortedCategories.length} Categories
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                नवीन Categories जोडा, नाव व फोटो बदला, क्रम नियंत्रित करा (Supabase Persistent)
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            id="btn-sync-categories"
            onClick={handleSync}
            disabled={isSyncing}
            className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            title="Supabase Cloud वरून Categories रीफ्रेश करा"
          >
            <RefreshCw size={13} className={isSyncing ? 'animate-spin text-[#0F2C59]' : ''} />
            <span>Sync</span>
          </button>

          <button
            type="button"
            id="btn-add-category"
            onClick={openAddModal}
            className="px-4 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-[#D4AF37] font-black text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer active:scale-95 border border-[#D4AF37]/40"
          >
            <Plus size={15} />
            <span>नवीन Category जोडा (Add)</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-4 border-b border-gray-100 bg-gray-50/50">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            id="input-search-categories"
            placeholder="Category नावाने शोधा..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] font-medium"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Categories Table / List */}
      {filteredCategories.length === 0 ? (
        <div className="p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3">
            <FolderTree size={28} />
          </div>
          <h3 className="text-sm font-extrabold text-gray-800">
            {searchQuery ? 'कोणतीही Category सापडली नाही' : 'कोणतीही Category अस्तित्वात नाही'}
          </h3>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `"${searchQuery}" शी जुळणारी Category उपलब्ध नाही.`
              : 'Admin पॅनेलमधून "नवीन Category जोडा" बटण वापरून पहिली Category तयार करा.'}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={openAddModal}
              className="mt-4 px-4 py-2 bg-[#0F2C59] text-[#D4AF37] font-bold text-xs rounded-xl shadow-xs transition hover:bg-[#163a6e] cursor-pointer"
            >
              + पहिली Category जोडा
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100/70 border-b border-gray-200 text-[11px] font-black text-gray-600 uppercase tracking-wider">
                <th className="py-3 px-4 w-16 text-center">क्रम</th>
                <th className="py-3 px-4 w-20 text-center">फोटो</th>
                <th className="py-3 px-4">Category नाव</th>
                <th className="py-3 px-4 text-center">जोडलेली उत्पादने</th>
                <th className="py-3 px-4 w-32 text-center">क्रम बदला</th>
                <th className="py-3 px-4 w-28 text-right">कृती (Actions)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {filteredCategories.map((cat, idx) => {
                const prodCount = getProductCountForCategory(cat);
                const isFirst = idx === 0;
                const isLast = idx === filteredCategories.length - 1;

                return (
                  <tr
                    key={cat.id}
                    className="hover:bg-amber-50/30 transition-colors group"
                  >
                    {/* Display Order Number */}
                    <td className="py-3 px-4 text-center font-bold text-gray-500">
                      <span className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center mx-auto text-[11px]">
                        {cat.displayOrder || idx + 1}
                      </span>
                    </td>

                    {/* Photo Thumbnail */}
                    <td className="py-3 px-4 text-center">
                      <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center mx-auto shrink-0 shadow-2xs">
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
                          <ImageIcon size={18} className="text-gray-400" />
                        )}
                      </div>
                    </td>

                    {/* Category Name & ID */}
                    <td className="py-3 px-4">
                      <div className="font-extrabold text-gray-900 text-sm">
                        {cat.name}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                        ID: {cat.id}
                      </div>
                    </td>

                    {/* Linked Products Count */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                          prodCount > 0
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {prodCount} उत्पादने
                      </span>
                    </td>

                    {/* Reorder Up / Down Controls */}
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-1 bg-gray-100 p-1 rounded-lg border border-gray-200">
                        <button
                          type="button"
                          id={`btn-move-up-${cat.id}`}
                          onClick={() => handleMove(idx, 'UP')}
                          disabled={isFirst}
                          className="p-1 rounded hover:bg-white text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          title="वर हलवा (Move Up)"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          id={`btn-move-down-${cat.id}`}
                          onClick={() => handleMove(idx, 'DOWN')}
                          disabled={isLast}
                          className="p-1 rounded hover:bg-white text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition"
                          title="खाली हलवा (Move Down)"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </td>

                    {/* Actions: Edit & Delete */}
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          id={`btn-edit-category-${cat.id}`}
                          onClick={() => openEditModal(cat)}
                          className="p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition cursor-pointer border border-indigo-200"
                          title="Category संपादित करा (Edit)"
                        >
                          <Edit2 size={13} />
                        </button>

                        <button
                          type="button"
                          id={`btn-delete-category-${cat.id}`}
                          onClick={() => setDeletingCategory(cat)}
                          className="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 transition cursor-pointer border border-rose-200"
                          title="Category हटवा (Delete with Confirmation)"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD / EDIT CATEGORY MODAL */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="bg-[#0F2C59] text-white p-4 sm:p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderTree size={18} className="text-[#D4AF37]" />
                <h3 className="font-extrabold text-sm sm:text-base">
                  {editingCategory ? 'Category संपादित करा (Edit Category)' : 'नवीन Category जोडा (Add Category)'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-300 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveCategory} className="p-5 space-y-4">
              {formError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Category Name Input */}
              <div>
                <label className="block text-xs font-black text-gray-700 mb-1">
                  Category चे नाव <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  id="category-name-input"
                  required
                  placeholder="उदा. तांदूळ आणि धान्य / Rice & Grains"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2.5 text-xs bg-white border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] font-bold text-gray-900"
                />
              </div>

              {/* Photo Upload Section */}
              <div>
                <label className="block text-xs font-black text-gray-700 mb-1">
                  Category फोटो <span className="text-gray-400 font-normal">(product-images/categories/ मध्ये सेव्ह होईल)</span>
                </label>

                {/* Thumbnail Preview if photo selected */}
                {imageUrl ? (
                  <div className="relative w-full h-36 bg-gray-100 rounded-xl overflow-hidden border border-gray-200 group mb-2">
                    <img
                      src={imageUrl}
                      alt="Category Preview"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-white text-gray-900 rounded-lg text-xs font-extrabold shadow hover:bg-gray-100 cursor-pointer"
                      >
                        फोटो बदला
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageUrl('')}
                        className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-extrabold shadow hover:bg-rose-700 cursor-pointer"
                      >
                        काढा
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 hover:border-[#0F2C59] rounded-xl p-6 text-center cursor-pointer transition bg-gray-50 hover:bg-gray-100/70"
                  >
                    {isUploading ? (
                      <div className="flex flex-col items-center justify-center gap-2 text-xs text-[#0F2C59] font-bold">
                        <RefreshCw size={20} className="animate-spin text-[#0F2C59]" />
                        <span>फोटो अपलोड होत आहे...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <div className="w-10 h-10 rounded-full bg-[#0F2C59]/10 text-[#0F2C59] flex items-center justify-center">
                          <Upload size={18} />
                        </div>
                        <span className="text-xs font-bold text-gray-700">
                          फोटो अपलोड करण्यासाठी क्लिक करा
                        </span>
                        <span className="text-[10px] text-gray-400">
                          JPEG, PNG, WebP (कमाल 15 MB)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp,image/jpg"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />

                {uploadError && (
                  <p className="text-[11px] text-rose-600 font-bold mt-1">
                    {uploadError}
                  </p>
                )}
              </div>

              {/* Optional Manual Image URL */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 mb-1">
                  किंवा Image URL थेट टाका (पर्यायी):
                </label>
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/..."
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full p-2 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-[#0F2C59] font-mono text-gray-700"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isSaving}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-100 transition cursor-pointer"
                >
                  रद्द करा (Cancel)
                </button>
                <button
                  type="submit"
                  id="btn-submit-category"
                  disabled={isSaving || isUploading}
                  className="px-5 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-[#D4AF37] font-extrabold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>जतन होत आहे...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>{editingCategory ? 'बदल जतन करा (Save Changes)' : 'Category जोडा (Create)'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deletingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border border-gray-200 p-5 text-center animate-in fade-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-3 shadow-xs">
              <ShieldAlert size={28} />
            </div>

            <h3 className="text-base font-black text-gray-900 mb-1">
              Category हटवण्याची खात्री करा
            </h3>

            <p className="text-xs text-gray-600 mb-3">
              तुम्हाला <strong>"{deletingCategory.name}"</strong> ही Category नक्की हटवायची आहे का?
            </p>

            {getProductCountForCategory(deletingCategory) > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-800 font-bold mb-4 text-left">
                ⚠️ या Category शी <strong>{getProductCountForCategory(deletingCategory)}</strong> उत्पादने जोडलेली आहेत.
                Category हटवल्यास संबंधित उत्पादने सुरक्षित राहतील, परंतु त्यांचा Category संदर्भ रिक्त होईल.
              </div>
            )}

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                id="btn-cancel-delete-category"
                onClick={() => setDeletingCategory(null)}
                disabled={isDeleting}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-100 transition cursor-pointer flex-1"
              >
                रद्द करा (Cancel)
              </button>

              <button
                type="button"
                id="btn-confirm-delete-category"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black shadow transition cursor-pointer flex-1 flex items-center justify-center gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>हटवत आहे...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>होय, हटवा (Confirm)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
