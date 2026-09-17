import React, { useState, useEffect } from 'react';
import { X, Save, Layers, Check, Trash2, AlertCircle } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { INITIAL_CATEGORIES } from '../data/seedData';
import { formatVariantPack } from '../utils/variantFormatter';

interface EditProductModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (productId: string, updates: Partial<Product>) => void;
}

export const EditProductModal: React.FC<EditProductModalProps> = ({
  product,
  isOpen,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [description, setDescription] = useState('');
  const [isDiscountExcluded, setIsDiscountExcluded] = useState(false);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setBrand(product.brand || '');
      setCategoryId(product.categoryId || 'cat-1');
      setImageUrl(product.imageUrl || '');
      setDescription(product.description || '');
      setIsDiscountExcluded(Boolean(product.isDiscountExcluded));
      setVariants(product.variants ? JSON.parse(JSON.stringify(product.variants)) : []);
      setSavedSuccess(false);
      setVariantError(null);
    }
  }, [product]);

  if (!isOpen || !product) return null;

  const handleUpdateVariant = (
    index: number,
    field: keyof ProductVariant,
    value: string | number
  ) => {
    setVariants((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        [field]: typeof updated[index][field] === 'number' ? Number(value) : value,
      };
      return updated;
    });
  };

  const handleDeleteVariant = (index: number) => {
    if (variants.length <= 1) {
      setVariantError('An item must have at least one pack variant.');
      setTimeout(() => setVariantError(null), 4000);
      return;
    }
    setVariantError(null);
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave(product.id, {
      name: name.trim(),
      brand: brand.trim() || 'General',
      categoryId,
      imageUrl: imageUrl.trim(),
      description: description.trim(),
      isDiscountExcluded,
      variants,
    });

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 400);
  };

  return (
    <div
      id="edit-product-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="edit-product-modal"
        className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden border border-gray-200 my-auto flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="bg-[#0F2C59] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-[#D4AF37] text-[#0F2C59] px-2 py-0.5 rounded-full">
                Edit Item
              </span>
              <span className="text-[11px] text-gray-300 font-mono">
                ID: {product.id}
              </span>
            </div>
            <h3 className="font-extrabold text-base sm:text-lg text-white mt-1 truncate">
              {name || product.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition shrink-0"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body - Scrollable */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {savedSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl flex items-center gap-2 font-bold animate-fade-in">
              <Check size={16} className="text-emerald-600" />
              <span>Changes saved successfully for this item!</span>
            </div>
          )}

          {/* Basic Item Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="font-bold text-gray-700 block mb-1">
                Item / Product Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                id="edit-product-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl font-semibold text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
                placeholder="e.g. Tata Salt"
              />
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Brand Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                id="edit-product-brand-input"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
                placeholder="e.g. Tata Salt"
              />
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">Category</label>
              <select
                id="edit-product-category-select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none bg-white"
              >
                {INITIAL_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="font-bold text-gray-700 block mb-1">Image URL</label>
            <input
              type="url"
              id="edit-product-image-input"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
            />
          </div>

          <div>
            <label className="font-bold text-gray-700 block mb-1">Description</label>
            <textarea
              rows={2}
              id="edit-product-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
              placeholder="Short description of this product..."
            />
          </div>

          {/* Price Capped / Regulated Item Toggle */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-gray-900">Price Regulated / Discount Excluded</div>
              <div className="text-[11px] text-gray-600">
                Exclude from online advance payment percentage discounts
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                id="edit-product-regulated-toggle"
                checked={isDiscountExcluded}
                onChange={(e) => setIsDiscountExcluded(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6B00]"></div>
            </label>
          </div>

          {/* Existing Pack Variants for this Item */}
          <div className="pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="font-extrabold text-[#0F2C59] flex items-center gap-1.5">
                <Layers size={14} className="text-[#D4AF37]" />
                <span>Existing Pack Variants ({variants.length})</span>
              </span>
              <span className="text-[10px] text-gray-500">
                Edit prices or stock directly
              </span>
            </div>

            {variantError && (
              <div className="mb-2.5 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2 font-bold animate-fadeIn">
                <AlertCircle size={14} className="shrink-0 text-red-600" />
                <span>{variantError}</span>
              </div>
            )}

            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {variants.map((variant, idx) => (
                <div
                  key={variant.id}
                  className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold text-gray-800 truncate">
                        {formatVariantPack(variant)}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        ({variant.id})
                      </span>
                    </div>
                    {variants.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteVariant(idx)}
                        className="text-gray-400 hover:text-red-600 transition p-1"
                        title="Remove Variant"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-600 block mb-0.5">
                        Selling Price (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={variant.baseSellingPrice}
                        onChange={(e) =>
                          handleUpdateVariant(idx, 'baseSellingPrice', e.target.value)
                        }
                        className="w-full p-1.5 border border-gray-300 rounded-lg text-xs font-bold text-[#0F2C59] bg-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-600 block mb-0.5">
                        MRP (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={variant.mrp}
                        onChange={(e) => handleUpdateVariant(idx, 'mrp', e.target.value)}
                        className="w-full p-1.5 border border-gray-300 rounded-lg text-xs bg-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-600 block mb-0.5">
                        Stock Qty
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={variant.stockQuantity}
                        onChange={(e) =>
                          handleUpdateVariant(idx, 'stockQuantity', e.target.value)
                        }
                        className="w-full p-1.5 border border-gray-300 rounded-lg text-xs bg-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-600 block mb-0.5">
                        Max Order Limit
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={variant.maxOrderLimit}
                        onChange={(e) =>
                          handleUpdateVariant(idx, 'maxOrderLimit', e.target.value)
                        }
                        className="w-full p-1.5 border border-gray-300 rounded-lg text-xs bg-white outline-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-gray-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              id="btn-cancel-edit-product"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-700 bg-gray-100 hover:bg-gray-200 font-bold transition text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-save-edit-product"
              className="px-5 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] text-white font-bold transition text-xs flex items-center gap-1.5 shadow-md active:scale-95"
            >
              <Save size={14} className="text-[#D4AF37]" />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
