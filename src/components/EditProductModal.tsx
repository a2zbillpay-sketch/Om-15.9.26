import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Layers, Check, Trash2, AlertCircle, Scan, Loader2, Plus } from 'lucide-react';
import { Product, ProductVariant, TieredPrice } from '../types';
import { useApp } from '../context/AppContext';
import { INITIAL_CATEGORIES } from '../data/seedData';
import { formatVariantPack } from '../utils/variantFormatter';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { ProductImageUploader } from './ProductImageUploader';
import { normalizeAndValidateBarcode } from '../lib/product-service';

interface EditProductModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    productId: string,
    updates: Partial<Product>
  ) => Promise<{ success: boolean; error?: string }> | void;
  existingProducts?: Product[];
}

export const EditProductModal: React.FC<EditProductModalProps> = ({
  product,
  isOpen,
  onClose,
  onSave,
  existingProducts = [],
}) => {
  const { categories, settings, reorderVariants } = useApp();
  const availableCategories = categories && categories.length > 0 ? categories : INITIAL_CATEGORIES;
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [barcode, setBarcode] = useState('');
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [searchKeywords, setSearchKeywords] = useState('');
  const [isDiscountExcluded, setIsDiscountExcluded] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState<string>('');
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [variantError, setVariantError] = useState<string | null>(null);

  // Dedicated Handle-Only Pointer Drag & Drop for Variants (Mobile Touch & Desktop)
  const [activeDragIdx, setActiveDragIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const variantListRef = useRef<HTMLDivElement>(null);
  const activeDragRef = useRef<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);
  const variantsRef = useRef<ProductVariant[]>(variants);
  variantsRef.current = variants;

  const handleHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>, fromIdx: number) => {
    // Only primary touch/click allowed
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (variants.length <= 1) return;

    // Prevent scrolling and text selection during drag on handle
    e.preventDefault();
    e.stopPropagation();

    activeDragRef.current = fromIdx;
    dropTargetRef.current = fromIdx;
    setActiveDragIdx(fromIdx);
    setDropTargetIdx(fromIdx);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (activeDragRef.current === null || !variantListRef.current) return;

      const clientY = moveEvent.clientY;
      const cardElements = variantListRef.current.querySelectorAll<HTMLElement>('[data-variant-card-idx]');
      let closestIdx: number | null = null;
      let minDistance = Infinity;

      cardElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const dist = Math.abs(clientY - midY);
        const idxAttr = el.getAttribute('data-variant-card-idx');
        if (idxAttr !== null) {
          const idxVal = Number(idxAttr);
          if (dist < minDistance) {
            minDistance = dist;
            closestIdx = idxVal;
          }
        }
      });

      if (closestIdx !== null && closestIdx !== dropTargetRef.current) {
        dropTargetRef.current = closestIdx;
        setDropTargetIdx(closestIdx);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      const from = activeDragRef.current;
      const to = dropTargetRef.current;

      activeDragRef.current = null;
      dropTargetRef.current = null;
      setActiveDragIdx(null);
      setDropTargetIdx(null);

      if (from !== null && to !== null && from !== to) {
        const currentVariants = [...variantsRef.current];
        const [movedItem] = currentVariants.splice(from, 1);
        currentVariants.splice(to, 0, movedItem);

        const sequenced = currentVariants.map((v, i) => ({
          ...v,
          displayOrder: i + 1,
        }));

        setVariants(sequenced);

        // Immediate persistence in AppContext, localStorage and Supabase
        if (product?.id && reorderVariants) {
          reorderVariants(product.id, sequenced).catch((err) => {
            console.warn('Reorder variants sync notice:', err);
          });
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  useEffect(() => {
    if (product) {
      setName(product.name || '');
      setBrand(product.brand || '');
      setCategoryId(product.categoryId || 'cat-1');
      setImageUrl(product.imageUrl || '');
      setBarcode(product.barcode || '');
      setBarcodeError(null);
      setDescription(product.description || '');
      setSearchKeywords(product.searchKeywords || '');
      setIsDiscountExcluded(Boolean(product.isDiscountExcluded));
      setLowStockThreshold(
        product.lowStockThreshold !== undefined && product.lowStockThreshold !== null
          ? String(product.lowStockThreshold)
          : ''
      );
      setVariants(product.variants ? JSON.parse(JSON.stringify(product.variants)) : []);
      setSavedSuccess(false);
      setIsSaving(false);
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
      let formattedVal: any = value;
      if (field === 'stockQuantity') {
        const num = Number(value);
        formattedVal = isNaN(num) || num < 0 ? 0 : num;
      } else if (field === 'baseSellingPrice') {
        // Keep string while typing to allow decimal typing such as 9.50, 9.5, 10.25 without swallowing "." or trailing "0"
        formattedVal = value;
      } else if (typeof updated[index][field] === 'number') {
        const num = Number(value);
        formattedVal = isNaN(num) ? 0 : num;
      }
      updated[index] = {
        ...updated[index],
        [field]: formattedVal,
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

  const handleAddSlabToVariant = (variantIdx: number) => {
    setVariants((prev) => {
      const updated = [...prev];
      const targetVariant = updated[variantIdx];
      const currentTiers: TieredPrice[] = Array.isArray(targetVariant.tieredPrices)
        ? [...targetVariant.tieredPrices]
        : [];

      const lastTier = currentTiers[currentTiers.length - 1];
      const defaultMin = lastTier
        ? (lastTier.maxQty < 9999 ? lastTier.maxQty + 1 : lastTier.minQty + 5)
        : 5;
      const basePrice = Number(targetVariant.baseSellingPrice || targetVariant.mrp || 100);
      const defaultPrice = Math.max(1, Math.round(basePrice * 0.95));

      const newTier: TieredPrice = {
        id: `tp-${targetVariant.id}-${Date.now()}-${currentTiers.length}`,
        variantId: targetVariant.id,
        minQty: defaultMin,
        maxQty: 9999,
        unitPrice: defaultPrice,
      };

      updated[variantIdx] = {
        ...targetVariant,
        tieredPrices: [...currentTiers, newTier],
      };
      return updated;
    });
  };

  const handleUpdateVariantSlab = (
    variantIdx: number,
    slabIdx: number,
    field: keyof TieredPrice,
    value: number
  ) => {
    setVariants((prev) => {
      const updated = [...prev];
      const targetVariant = updated[variantIdx];
      const currentTiers = Array.isArray(targetVariant.tieredPrices)
        ? [...targetVariant.tieredPrices]
        : [];
      if (!currentTiers[slabIdx]) return prev;

      currentTiers[slabIdx] = {
        ...currentTiers[slabIdx],
        [field]: value,
      };

      updated[variantIdx] = {
        ...targetVariant,
        tieredPrices: currentTiers,
      };
      return updated;
    });
  };

  const handleRemoveVariantSlab = (variantIdx: number, slabIdx: number) => {
    setVariants((prev) => {
      const updated = [...prev];
      const targetVariant = updated[variantIdx];
      const currentTiers = Array.isArray(targetVariant.tieredPrices)
        ? [...targetVariant.tieredPrices]
        : [];
      currentTiers.splice(slabIdx, 1);

      updated[variantIdx] = {
        ...targetVariant,
        tieredPrices: currentTiers,
      };
      return updated;
    });
  };

  const barcodeConflict = barcode.trim()
    ? existingProducts.find(
        (p) =>
          p.id !== product?.id &&
          p.barcode &&
          p.barcode.trim().toLowerCase() === barcode.trim().toLowerCase()
      )
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let validatedBarcode: string | undefined = undefined;
    if (barcode.trim()) {
      const barcodeValidation = normalizeAndValidateBarcode(barcode);
      if (!barcodeValidation.valid) {
        setBarcodeError(barcodeValidation.error || 'Invalid barcode format.');
        return;
      }
      if (barcodeConflict) {
        setBarcodeError(
          `Barcode "${barcodeValidation.barcode}" is already assigned to "${barcodeConflict.name}"${barcodeConflict.brand ? ` (${barcodeConflict.brand})` : ''}. Barcodes must be unique.`
        );
        return;
      }
      validatedBarcode = barcodeValidation.barcode || undefined;
    }

    setIsSaving(true);
    setVariantError(null);

    const parsedThreshold =
      lowStockThreshold.trim() !== '' && !isNaN(Number(lowStockThreshold))
        ? Math.max(1, parseInt(lowStockThreshold, 10))
        : undefined;

    // Process variants: allow decimal Selling Prices and preserve independent slabs for each variant
    const processedVariants = variants.map((v, idx) => {
      const cleanPrice = String(v.baseSellingPrice || '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
      const numSellingPrice = parseFloat(cleanPrice) || 0;
      const validTieredPrices = Array.isArray(v.tieredPrices)
        ? v.tieredPrices
            .filter((tp) => Number(tp.minQty) > 0 && Number(tp.unitPrice) > 0)
            .map((tp, tpIdx) => ({
              id: tp.id || `tp-${v.id}-${tpIdx}-${Date.now()}`,
              variantId: v.id,
              minQty: Number(tp.minQty),
              maxQty: tp.maxQty && Number(tp.maxQty) >= Number(tp.minQty) ? Number(tp.maxQty) : 9999,
              unitPrice: Number(tp.unitPrice),
            }))
        : [];

      return {
        ...v,
        displayOrder: idx + 1,
        mrp: Number(v.mrp),
        baseSellingPrice: numSellingPrice,
        purchasePrice:
          v.purchasePrice !== undefined && v.purchasePrice !== null && !isNaN(Number(v.purchasePrice))
            ? Number(v.purchasePrice)
            : undefined,
        discount:
          v.discount !== undefined && v.discount !== null && !isNaN(Number(v.discount))
            ? Number(v.discount)
            : undefined,
        stockQuantity: Number(v.stockQuantity),
        maxOrderLimit: Number(v.maxOrderLimit || 12),
        tieredPrices: validTieredPrices,
      };
    });

    for (let i = 0; i < processedVariants.length; i++) {
      const v = processedVariants[i];
      if (isNaN(v.baseSellingPrice) || v.baseSellingPrice <= 0) {
        setVariantError(`Variant #${i + 1}: Selling Price must be greater than 0 (e.g. ₹9.50, ₹10.25).`);
        return;
      }
      if (v.baseSellingPrice > v.mrp) {
        setVariantError(`Variant #${i + 1}: Base Selling Price (₹${v.baseSellingPrice}) cannot exceed MRP (₹${v.mrp}).`);
        return;
      }
    }

    try {
      const res = await onSave(product.id, {
        name: name.trim(),
        brand: brand.trim(),
        categoryId,
        imageUrl: imageUrl.trim(),
        barcode: validatedBarcode,
        description: description.trim(),
        searchKeywords: searchKeywords.trim() || undefined,
        isDiscountExcluded,
        lowStockThreshold: parsedThreshold,
        variants: processedVariants,
      });

      if (res && !res.success) {
        setVariantError(res.error || 'Failed to save product updates.');
        setIsSaving(false);
        return;
      }

      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        setIsSaving(false);
        onClose();
      }, 400);
    } catch (err: any) {
      setVariantError(err?.message || 'Failed to save product updates.');
      setIsSaving(false);
    }
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
                Brand Name <span className="text-xs text-gray-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                id="edit-product-brand-input"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
                placeholder="e.g. Tata Salt (Optional)"
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
                {availableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-gray-700">
                  Barcode <span className="text-xs text-gray-400 font-normal">(Optional)</span>
                </label>
                <button
                  type="button"
                  id="edit-scan-barcode-btn"
                  onClick={() => setIsBarcodeScannerOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F2C59] hover:text-[#FF6B00] transition-colors py-0.5 px-2 rounded-lg hover:bg-orange-50 border border-gray-200 hover:border-[#FF6B00]/40"
                  title="Scan barcode with camera"
                >
                  <Scan className="w-3.5 h-3.5 text-[#FF6B00]" />
                  <span>Scan</span>
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  id="edit-product-barcode-input"
                  value={barcode}
                  onChange={(e) => {
                    setBarcode(e.target.value);
                    setBarcodeError(null);
                  }}
                  placeholder="e.g. 8901030383321"
                  className={`w-full p-2.5 border rounded-xl font-mono text-gray-900 outline-none pr-9 ${
                    barcodeConflict
                      ? 'border-amber-400 bg-amber-50/50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                      : barcodeError
                      ? 'border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                      : 'border-gray-300 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setIsBarcodeScannerOpen(true)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#FF6B00] transition-colors p-1"
                  title="Scan barcode with camera"
                >
                  <Scan className="w-4 h-4" />
                </button>
              </div>
              {barcodeConflict && (
                <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                  Already used by &quot;{barcodeConflict.name}&quot;{barcodeConflict.brand ? ` (${barcodeConflict.brand})` : ''}
                </p>
              )}
              {barcodeError && (
                <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                  {barcodeError}
                </p>
              )}
            </div>
          </div>

          <ProductImageUploader
            currentImageUrl={imageUrl}
            onImageChange={(newUrl) => setImageUrl(newUrl)}
            productName={name}
          />

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

          <div>
            <label className="font-bold text-gray-700 block mb-1">
              Search Keywords / Synonyms <span className="text-xs text-gray-400 font-normal">(Comma-separated • For customer search only)</span>
            </label>
            <input
              type="text"
              id="edit-product-search-keywords-input"
              value={searchKeywords}
              onChange={(e) => setSearchKeywords(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
              placeholder="e.g. साबण, bathing bar, bath soap, santur"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              अनेक शोध शब्द स्वल्पविरामाने (comma) वेगळे करा. हे शब्द ग्राहकांना शोधताना उपयोगी पडतील पण स्टोअरमध्ये स्वतंत्रपणे दिसणार नाहीत.
            </p>
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

          {/* Low-Stock Alert Warning Threshold (Units) */}
          <div className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <label className="font-bold text-gray-900 text-xs block">
                Low-Stock Alert Warning Threshold (Units)
              </label>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Displays a warning badge on this product in inventory when quantity drops at or below this number.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min="1"
                id="edit-product-threshold-input"
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
                placeholder={`Store default (${settings?.lowStockThreshold ?? 10})`}
                className="w-36 p-2 text-xs border border-gray-300 rounded-lg bg-white text-gray-900 focus:border-[#0F2C59] outline-none font-bold text-center"
              />
              <span className="text-xs text-gray-500 font-medium">units</span>
            </div>
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

            <div ref={variantListRef} className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {variants.map((variant, idx) => {
                const isBeingDragged = activeDragIdx === idx;
                const isDropTarget = dropTargetIdx === idx && activeDragIdx !== null && activeDragIdx !== idx;

                return (
                  <React.Fragment key={variant.id}>
                    {/* Clear Drop Indicator Bar when dragging over this position */}
                    {isDropTarget && (
                      <div className="flex items-center gap-2 py-1 my-0.5 px-2.5 rounded-lg bg-orange-100/90 border border-orange-300 shadow-xs animate-fadeIn">
                        <div className="w-2 h-2 rounded-full bg-[#FF6B00] animate-ping shrink-0" />
                        <div className="h-0.5 flex-1 bg-[#FF6B00] rounded-full" />
                        <span className="text-[10px] font-black text-[#FF6B00] uppercase tracking-wider shrink-0 flex items-center gap-1">
                          <span>Drop Here</span>
                          <span className="font-mono bg-white px-1.5 py-0.2 rounded border border-orange-300 text-[9px] text-gray-800">
                            #{idx + 1}
                          </span>
                        </span>
                        <div className="h-0.5 flex-1 bg-[#FF6B00] rounded-full" />
                        <div className="w-2 h-2 rounded-full bg-[#FF6B00] animate-ping shrink-0" />
                      </div>
                    )}

                    <div
                      data-variant-card-idx={idx}
                      className={`p-3 rounded-xl border text-xs space-y-2 transition-all relative ${
                        isBeingDragged
                          ? 'opacity-40 border-2 border-dashed border-[#0F2C59] bg-blue-50/20 scale-[0.99]'
                          : isDropTarget
                          ? 'border-2 border-dashed border-[#FF6B00] bg-orange-50/40 ring-2 ring-[#FF6B00]/30 shadow-xs'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {variants.length > 1 && (
                            <div
                              data-drag-handle
                              onPointerDown={(e) => handleHandlePointerDown(e, idx)}
                              className="touch-none select-none w-7 h-7 rounded-lg bg-white hover:bg-[#0F2C59] active:bg-[#0F2C59] text-gray-600 hover:text-white active:text-white flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors shrink-0 shadow-2xs border border-gray-300 hover:border-[#0F2C59]"
                              title="Hold and drag ⠿ to reorder variant"
                              aria-label="Drag handle to reorder variant"
                            >
                              <span className="text-sm font-black leading-none select-none tracking-tighter">
                                ⠿
                              </span>
                            </div>
                          )}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0F2C59] text-white shrink-0">
                            #{idx + 1}{idx === 0 ? ' (Default)' : ''}
                          </span>
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
                        step="any"
                        min="0"
                        placeholder="e.g. 9.50"
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

                  {/* Wholesale Bulk Discount Slab (Optional) for EACH product variant */}
                  <div className="mt-2.5 pt-2 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-gray-800 text-[11px] flex items-center gap-1.5">
                        <Layers size={13} className="text-[#FF6B00]" />
                        <span>Wholesale Bulk Discount Slab (Optional)</span>
                        {variant.tieredPrices && variant.tieredPrices.length > 0 && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded-full">
                            {variant.tieredPrices.length} {variant.tieredPrices.length === 1 ? 'Slab' : 'Slabs'}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Slabs for this specific variant */}
                    {variant.tieredPrices && variant.tieredPrices.length > 0 ? (
                      <div className="space-y-1.5 mb-2">
                        {variant.tieredPrices.map((tier, slabIdx) => (
                          <div
                            key={tier.id || `slab-${slabIdx}`}
                            className="bg-white p-2 rounded-lg border border-gray-200 shadow-2xs flex items-center gap-2 flex-wrap sm:flex-nowrap"
                          >
                            <span className="text-[10px] font-black text-[#0F2C59] w-12 shrink-0">
                              #{slabIdx + 1}
                            </span>
                            <div className="flex-1 min-w-[70px]">
                              <span className="text-[9px] text-gray-500 block">Min Qty *</span>
                              <input
                                type="number"
                                min="2"
                                value={tier.minQty || ''}
                                onChange={(e) =>
                                  handleUpdateVariantSlab(
                                    idx,
                                    slabIdx,
                                    'minQty',
                                    Number(e.target.value) || 0
                                  )
                                }
                                placeholder="Min"
                                className="w-full p-1 border border-gray-300 rounded text-xs bg-white outline-none focus:border-[#0F2C59]"
                              />
                            </div>
                            <div className="flex-1 min-w-[70px]">
                              <span className="text-[9px] text-gray-500 block">Max Qty (Opt)</span>
                              <input
                                type="number"
                                min="2"
                                value={tier.maxQty === 9999 ? '' : tier.maxQty || ''}
                                onChange={(e) =>
                                  handleUpdateVariantSlab(
                                    idx,
                                    slabIdx,
                                    'maxQty',
                                    Number(e.target.value) || 9999
                                  )
                                }
                                placeholder="9999"
                                className="w-full p-1 border border-gray-300 rounded text-xs bg-white outline-none focus:border-[#0F2C59]"
                              />
                            </div>
                            <div className="flex-1 min-w-[80px]">
                              <span className="text-[9px] text-gray-500 block">Slab Price (₹) *</span>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={tier.unitPrice || ''}
                                onChange={(e) =>
                                  handleUpdateVariantSlab(
                                    idx,
                                    slabIdx,
                                    'unitPrice',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                placeholder="₹ Price"
                                className="w-full p-1 border border-emerald-300 rounded text-xs font-bold text-emerald-800 bg-white outline-none focus:border-emerald-600"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveVariantSlab(idx, slabIdx)}
                              className="p-1 text-gray-400 hover:text-red-500 transition shrink-0 mt-3 sm:mt-0 cursor-pointer"
                              title="Remove this slab"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-500 mb-2 italic">
                        No bulk discount slabs configured yet for this pack size.
                      </p>
                    )}

                    {/* Visible "Add Slab" button below the slab section of EACH product variant */}
                    <button
                      type="button"
                      id={`btn-add-slab-variant-${idx}`}
                      onClick={() => handleAddSlabToVariant(idx)}
                      className="w-full py-1.5 px-3 border border-dashed border-[#0F2C59]/40 hover:border-[#0F2C59] bg-white hover:bg-blue-50/60 text-[#0F2C59] font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs active:scale-98"
                    >
                      <Plus size={13} className="text-[#FF6B00]" />
                      <span>+ Add Slab</span>
                    </button>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
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
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] text-white font-bold transition text-xs flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-60 cursor-pointer"
            >
              {isSaving ? (
                <Loader2 size={14} className="animate-spin text-[#D4AF37]" />
              ) : (
                <Save size={14} className="text-[#D4AF37]" />
              )}
              <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Camera Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        onScan={(scanned) => {
          setBarcode(scanned);
          setBarcodeError(null);
        }}
        title={`Scan Barcode for ${name || product.name}`}
        subtitle="Align product package barcode within camera frame"
        currentBarcode={barcode}
        existingProducts={existingProducts}
        excludeProductId={product.id}
      />
    </div>
  );
};
