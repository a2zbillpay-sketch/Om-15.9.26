import React, { useState, useEffect } from 'react';
import {
  X,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Save,
  Check,
  Search,
  Filter,
  Package,
  Layers,
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronsUp,
  ChevronsDown,
} from 'lucide-react';
import { Product, Category } from '../types';
import { useApp } from '../context/AppContext';
import { formatVariantPack } from '../utils/variantFormatter';

interface ProductReorderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProductReorderModal: React.FC<ProductReorderModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { products, categories, reorderProducts } = useApp();
  const [orderedProducts, setOrderedProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Initialize ordered products from current products array
      const sorted = [...products].sort((a, b) => {
        const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 999999;
        const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 999999;
        return orderA - orderB;
      });
      setOrderedProducts(sorted);
      setHasUnsavedChanges(false);
      setSaveSuccess(false);
      setErrorMessage(null);
    }
  }, [isOpen, products]);

  if (!isOpen) return null;

  const categoryMap = new Map<string, string>();
  categories.forEach((c) => {
    categoryMap.set(c.id, c.name);
    categoryMap.set(c.name.toLowerCase(), c.name);
  });

  // Filtered view for searching or category filtering
  const visibleProducts = orderedProducts.filter((p) => {
    const matchesCategory =
      selectedCategory === 'ALL' ||
      p.categoryId === selectedCategory ||
      (p.categoryId && p.categoryId.toLowerCase() === selectedCategory.toLowerCase());

    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.brand && p.brand.toLowerCase().includes(q));

    return matchesCategory && matchesSearch;
  });

  const isFiltering = selectedCategory !== 'ALL' || searchQuery.trim().length > 0;

  // Move product in master list
  const moveProductInMaster = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= orderedProducts.length) return;
    setOrderedProducts((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  // Move product when filtered
  const handleMoveProductRelative = (productId: string, direction: 'UP' | 'DOWN' | 'TOP' | 'BOTTOM') => {
    const currentIndex = orderedProducts.findIndex((p) => p.id === productId);
    if (currentIndex === -1) return;

    if (direction === 'TOP') {
      moveProductInMaster(currentIndex, 0);
      return;
    }
    if (direction === 'BOTTOM') {
      moveProductInMaster(currentIndex, orderedProducts.length - 1);
      return;
    }

    if (!isFiltering) {
      const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
      moveProductInMaster(currentIndex, targetIndex);
    } else {
      // Move relative to the visible list
      const visibleIndex = visibleProducts.findIndex((p) => p.id === productId);
      if (visibleIndex === -1) return;
      const targetVisibleIndex = direction === 'UP' ? visibleIndex - 1 : visibleIndex + 1;
      if (targetVisibleIndex < 0 || targetVisibleIndex >= visibleProducts.length) return;

      const targetProduct = visibleProducts[targetVisibleIndex];
      const targetMasterIndex = orderedProducts.findIndex((p) => p.id === targetProduct.id);
      if (targetMasterIndex !== -1) {
        moveProductInMaster(currentIndex, targetMasterIndex);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch {
      // ignore
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIdx === null || draggedIdx === targetIndex) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    if (isFiltering) {
      // When filtered, reorder based on the visible list item IDs
      const draggedItem = visibleProducts[draggedIdx];
      const targetItem = visibleProducts[targetIndex];
      if (draggedItem && targetItem) {
        const fromMaster = orderedProducts.findIndex((p) => p.id === draggedItem.id);
        const toMaster = orderedProducts.findIndex((p) => p.id === targetItem.id);
        if (fromMaster !== -1 && toMaster !== -1) {
          moveProductInMaster(fromMaster, toMaster);
        }
      }
    } else {
      moveProductInMaster(draggedIdx, targetIndex);
    }

    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleSaveOrder = async () => {
    try {
      setIsSaving(true);
      setErrorMessage(null);

      // Reassign sequence numbers displayOrder: 1, 2, 3...
      const sequenced = orderedProducts.map((p, idx) => ({
        ...p,
        displayOrder: idx + 1,
      }));

      await reorderProducts(sequenced);
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to save product display sequence.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    const sorted = [...products].sort((a, b) => {
      const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 999999;
      const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 999999;
      return orderA - orderB;
    });
    setOrderedProducts(sorted);
    setHasUnsavedChanges(false);
    setSaveSuccess(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="bg-[#0F2C59] text-white p-4 sm:p-5 flex items-center justify-between border-b-2 border-[#D4AF37]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#D4AF37]">
              <GripVertical size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-wide text-white">
                  Reorder Products (वस्तूंचा क्रम बदला)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#D4AF37] text-[#0F2C59]">
                  {orderedProducts.length} Items
                </span>
              </div>
              <p className="text-xs text-gray-300 mt-0.5">
                Drag and drop rows or use arrow buttons to arrange products. This exact sequence will appear to customers.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-300 hover:text-white p-2 rounded-xl hover:bg-white/10 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Toolbar: Category Filter & Search */}
        <div className="p-3 sm:p-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search products to locate..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg outline-none bg-white focus:border-[#0F2C59]"
              />
            </div>

            <div className="relative w-44">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full py-1.5 px-2.5 text-xs border border-gray-300 rounded-lg outline-none bg-white font-medium text-gray-700"
              >
                <option value="ALL">All Categories ({categories.length})</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasUnsavedChanges && (
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition"
              >
                Reset
              </button>
            )}

            <button
              type="button"
              onClick={handleSaveOrder}
              disabled={isSaving || !hasUnsavedChanges}
              className={`px-4 py-1.5 text-xs font-black rounded-xl flex items-center gap-1.5 shadow-sm transition active:scale-95 ${
                hasUnsavedChanges
                  ? 'bg-[#FF6B00] hover:bg-[#e66000] text-white cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Saving Order...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check size={14} className="text-emerald-400" />
                  <span>Order Saved!</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <span>Save Product Order</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Feedback Alerts */}
        {saveSuccess && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 flex items-center justify-between text-xs text-emerald-800 font-bold">
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-emerald-600" />
              <span>Product display order saved successfully across database and customer app!</span>
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between text-xs text-red-700 font-bold">
            <span className="flex items-center gap-1.5">
              <AlertCircle size={14} className="text-red-500" />
              <span>{errorMessage}</span>
            </span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-500 hover:text-red-700"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {isFiltering && (
          <div className="bg-amber-50 px-4 py-1.5 border-b border-amber-200 text-[11px] text-amber-800 font-medium flex items-center justify-between">
            <span>
              Showing {visibleProducts.length} filtered items. Reordering will adjust their sequence in the store catalog.
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('ALL');
                setSearchQuery('');
              }}
              className="text-[#0F2C59] font-bold hover:underline"
            >
              Clear filters to view all
            </button>
          </div>
        )}

        {/* Product List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2">
          {visibleProducts.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <Package size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-bold text-gray-700">No products match your filter.</p>
              <p className="text-xs text-gray-400 mt-1">Try clearing your search term or category selection.</p>
            </div>
          ) : (
            visibleProducts.map((product, idx) => {
              const masterIndex = orderedProducts.findIndex((p) => p.id === product.id);
              const categoryName = categoryMap.get(product.categoryId) || 'General';
              const variantCount = Array.isArray(product.variants) ? product.variants.length : 0;
              const defaultVariant = product.variants && product.variants[0];

              return (
                <div
                  key={product.id}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={() => {
                    setDraggedIdx(null);
                    setDragOverIdx(null);
                  }}
                  className={`bg-white rounded-xl border p-2.5 sm:p-3 flex items-center justify-between gap-3 transition-all select-none ${
                    dragOverIdx === idx
                      ? 'border-[#FF6B00] ring-2 ring-[#FF6B00]/30 bg-orange-50/40'
                      : 'border-gray-200 hover:border-gray-300 shadow-2xs hover:shadow-xs'
                  } ${draggedIdx === idx ? 'opacity-40 scale-[0.99]' : 'opacity-100'}`}
                >
                  {/* Left: Grip Handle + Rank Badge + Thumbnail + Details */}
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                    <div
                      className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-[#0F2C59] p-1 rounded hover:bg-gray-100 transition shrink-0"
                      title="Drag to reorder"
                    >
                      <GripVertical size={16} />
                    </div>

                    <div className="w-8 h-8 rounded-lg bg-[#0F2C59] text-white flex items-center justify-center font-black text-xs shrink-0 shadow-2xs">
                      #{masterIndex + 1}
                    </div>

                    <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                      {product.imageUrl && product.imageUrl.trim() ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-full h-full object-contain p-0.5"
                          loading="lazy"
                        />
                      ) : (
                        <Package size={20} className="text-gray-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-gray-900 text-xs sm:text-sm truncate">
                          {product.name}
                        </span>
                        {product.brand && (
                          <span className="text-[10px] text-gray-500 font-medium px-1.5 py-0.2 bg-gray-100 rounded">
                            {product.brand}
                          </span>
                        )}
                        <span className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded font-semibold">
                          {categoryName}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                        <span>
                          {variantCount} pack {variantCount === 1 ? 'variant' : 'variants'}
                        </span>
                        {defaultVariant && (
                          <span className="font-bold text-[#0F2C59]">
                            Starting ₹{defaultVariant.baseSellingPrice} ({formatVariantPack(defaultVariant)})
                          </span>
                        )}
                        {product.barcode && (
                          <span className="font-mono text-[10px] text-gray-400">
                            [{product.barcode}]
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Quick Move Controls */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveProductRelative(product.id, 'TOP')}
                      disabled={idx === 0}
                      className={`p-1.5 rounded-lg border text-xs transition ${
                        idx === 0
                          ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-[#0F2C59]'
                      }`}
                      title="Move to Top (#1)"
                    >
                      <ChevronsUp size={13} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMoveProductRelative(product.id, 'UP')}
                      disabled={idx === 0}
                      className={`p-1.5 rounded-lg border text-xs transition ${
                        idx === 0
                          ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-[#0F2C59]'
                      }`}
                      title="Move Up"
                    >
                      <ArrowUp size={13} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMoveProductRelative(product.id, 'DOWN')}
                      disabled={idx === visibleProducts.length - 1}
                      className={`p-1.5 rounded-lg border text-xs transition ${
                        idx === visibleProducts.length - 1
                          ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-[#0F2C59]'
                      }`}
                      title="Move Down"
                    >
                      <ArrowDown size={13} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMoveProductRelative(product.id, 'BOTTOM')}
                      disabled={idx === visibleProducts.length - 1}
                      className={`p-1.5 rounded-lg border text-xs transition ${
                        idx === visibleProducts.length - 1
                          ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-[#0F2C59]'
                      }`}
                      title="Move to Bottom"
                    >
                      <ChevronsDown size={13} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {hasUnsavedChanges ? (
              <span className="text-amber-700 font-bold flex items-center gap-1">
                <Sparkles size={13} className="text-amber-500" />
                <span>You have unsaved order changes. Click "Save Product Order" to apply.</span>
              </span>
            ) : (
              <span>All products are ordered and synchronized with the store.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveOrder}
              disabled={isSaving || !hasUnsavedChanges}
              className={`px-4 py-2 text-xs font-black rounded-xl flex items-center gap-1.5 shadow-sm transition active:scale-95 ${
                hasUnsavedChanges
                  ? 'bg-[#0F2C59] hover:bg-[#153e7d] text-white cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={14} className="text-[#D4AF37]" />
                  <span>Save Order</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
