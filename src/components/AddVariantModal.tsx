import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Layers, Check, AlertCircle, Info, Tag } from 'lucide-react';
import { Product, ProductVariant, UnitType, TieredPrice } from '../types';
import { formatVariantPack } from '../utils/variantFormatter';

interface AddVariantModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onAddVariant: (productId: string, newVariant: ProductVariant) => void;
}

const UNIT_OPTIONS: { value: UnitType; label: string; defaultSize: number }[] = [
  { value: UnitType.G, label: 'G (Grams - e.g. 500 G, 250 G, 100 G)', defaultSize: 500 },
  { value: UnitType.KG, label: 'KG (Kilograms - e.g. 1 KG, 5 KG, 10 KG)', defaultSize: 1 },
  { value: UnitType.ML, label: 'ML (Milliliters - e.g. 200 ML, 500 ML)', defaultSize: 500 },
  { value: UnitType.LITER, label: 'LITER (Liters - e.g. 1 LITER, 5 LITER)', defaultSize: 1 },
  { value: UnitType.BOX, label: 'BOX (Box / Pack)', defaultSize: 1 },
  { value: UnitType.CAN, label: 'CAN (Can / Tin / Pipa)', defaultSize: 1 },
  { value: UnitType.KATTA, label: 'KATTA (Bori / Sack - Wholesale)', defaultSize: 25 },
  { value: UnitType.NOS, label: 'NOS (Pieces / Units)', defaultSize: 1 },
];

export const AddVariantModal: React.FC<AddVariantModalProps> = ({
  product,
  isOpen,
  onClose,
  onAddVariant,
}) => {
  const [unit, setUnit] = useState<UnitType>(UnitType.G);
  const [packSize, setPackSize] = useState<number | string>('500');
  const [packLabel, setPackLabel] = useState('500 G');
  const [isCustomLabel, setIsCustomLabel] = useState(false);

  const [mrp, setMrp] = useState<number | string>('100');
  const [baseSellingPrice, setBaseSellingPrice] = useState<number | string>('85');
  const [stockQuantity, setStockQuantity] = useState<number | string>('100');
  const [maxOrderLimit, setMaxOrderLimit] = useState<number | string>('12');

  // Wholesale bulk slab
  const [enableTierSlab, setEnableTierSlab] = useState(false);
  const [tierMinQty, setTierMinQty] = useState<number | string>('5');
  const [tierUnitPrice, setTierUnitPrice] = useState<number | string>('80');

  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (product && isOpen) {
      // Default initial state
      setUnit(UnitType.G);
      setPackSize('500');
      setPackLabel('500 G');
      setIsCustomLabel(false);
      setMrp('100');
      setBaseSellingPrice('85');
      setStockQuantity('100');
      setMaxOrderLimit('12');
      setEnableTierSlab(false);
      setTierMinQty('5');
      setTierUnitPrice('80');
      setSavedSuccess(false);
    }
  }, [product, isOpen]);

  // Compute live formatted preview label
  const livePreviewLabel = useMemo(() => {
    const numericSize = Number(packSize) || 1;
    return formatVariantPack({
      packLabel: packLabel.trim() || undefined,
      packSize: numericSize,
      unit,
    });
  }, [packLabel, packSize, unit]);

  if (!isOpen || !product) return null;

  const handleUnitChange = (newUnit: UnitType) => {
    setUnit(newUnit);
    // If user hasn't manually entered a custom package label, automatically sync default
    if (!isCustomLabel) {
      const opt = UNIT_OPTIONS.find((o) => o.value === newUnit);
      const newSize = opt ? opt.defaultSize : 1;
      setPackSize(String(newSize));
      setPackLabel(`${newSize} ${newUnit}`);
    }
  };

  const handleSizeChange = (val: string) => {
    setPackSize(val);
    if (!isCustomLabel) {
      setPackLabel(val ? `${val} ${unit}` : '');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const finalPackSize = Number(packSize) || 1;
    const finalMrp = Number(mrp) || 0;
    const finalSellingPrice = Number(baseSellingPrice) || 0;
    const finalStock = Number(stockQuantity) || 0;
    const finalMaxLimit = Number(maxOrderLimit) || 10;

    // Use formatVariantPack to guarantee that the unit (e.g. "G", "KG") is ALWAYS preserved and visible
    const finalLabel = formatVariantPack({
      packLabel: packLabel.trim() || undefined,
      packSize: finalPackSize,
      unit,
    });

    const variantId = `var-${product.id}-${Date.now()}`;

    const tieredPrices: TieredPrice[] =
      enableTierSlab && Number(tierMinQty) > 0 && Number(tierUnitPrice) > 0
        ? [
            {
              id: `tp-${Date.now()}`,
              variantId,
              minQty: Number(tierMinQty),
              maxQty: 9999,
              unitPrice: Number(tierUnitPrice),
            },
          ]
        : [];

    const newVariant: ProductVariant = {
      id: variantId,
      productId: product.id,
      unit,
      packSize: finalPackSize,
      packLabel: finalLabel,
      mrp: finalMrp,
      baseSellingPrice: finalSellingPrice,
      stockQuantity: finalStock,
      maxOrderLimit: finalMaxLimit,
      tieredPrices,
    };

    onAddVariant(product.id, newVariant);
    setSavedSuccess(true);

    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 400);
  };

  return (
    <div
      id="add-variant-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="add-variant-modal"
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-gray-200 my-auto flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="bg-[#0F2C59] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-[#FF6B00] text-white px-2 py-0.5 rounded-full">
                + Add Variant
              </span>
              <span className="text-[11px] text-gray-300 font-mono">
                Item ID: {product.id}
              </span>
            </div>
            <h3 className="font-extrabold text-base sm:text-lg text-white mt-1 truncate">
              {product.name}
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

        {/* Product Connection Notice */}
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center gap-2 text-xs text-blue-900">
          <Info size={15} className="text-[#0F2C59] shrink-0" />
          <span>
            Adding new pack variant directly to <strong>{product.name}</strong> ({product.brand}). The main product will not be duplicated.
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {savedSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl flex items-center gap-2 font-bold">
              <Check size={16} className="text-emerald-600" />
              <span>New pack variant linked successfully!</span>
            </div>
          )}

          {/* Unit Type & Size */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Unit Type <span className="text-red-500">*</span>
              </label>
              <select
                id="variant-unit-select"
                value={unit}
                onChange={(e) => handleUnitChange(e.target.value as UnitType)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none bg-white font-bold"
              >
                {UNIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Pack Numeric Size <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                id="variant-pack-size-input"
                value={packSize}
                onChange={(e) => handleSizeChange(e.target.value)}
                placeholder="e.g. 500, 250, 1"
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none font-bold"
              />
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-gray-700">
                  Pack Label / Title
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomLabel(false);
                    setPackLabel(`${packSize} ${unit}`);
                  }}
                  className="text-[10px] text-blue-600 hover:text-blue-800 font-bold"
                >
                  Reset to Auto: "{packSize} {unit}"
                </button>
              </div>
              <input
                type="text"
                id="variant-pack-label-input"
                value={packLabel}
                onChange={(e) => {
                  setPackLabel(e.target.value);
                  setIsCustomLabel(true);
                }}
                placeholder={`e.g. ${packSize} ${unit} Pack, ${packSize} ${unit} Pouch`}
                className="w-full p-2.5 border border-gray-300 rounded-xl font-semibold text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
              />
            </div>

            {/* Live Display Preview */}
            <div className="sm:col-span-2 bg-gradient-to-r from-amber-50 to-blue-50 border border-amber-200/80 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                <Tag size={13} className="text-[#FF6B00]" />
                <span>Customer & Admin Display Title:</span>
              </span>
              <span className="font-extrabold text-[#0F2C59] text-xs bg-white px-2.5 py-1 rounded-lg border border-amber-300 shadow-2xs">
                {livePreviewLabel}
              </span>
            </div>
          </div>

          {/* Pricing & Stock */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Selling Price (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                required
                id="variant-selling-price-input"
                value={baseSellingPrice}
                onChange={(e) => setBaseSellingPrice(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl font-black text-[#0F2C59] text-sm focus:border-[#0F2C59] outline-none"
              />
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">
                MRP (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                required
                id="variant-mrp-input"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] outline-none"
              />
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Stock (Units) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                required
                id="variant-stock-input"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] outline-none"
              />
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Max Limit/Order <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                id="variant-max-limit-input"
                value={maxOrderLimit}
                onChange={(e) => setMaxOrderLimit(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-xl text-gray-900 focus:border-[#0F2C59] outline-none"
              />
            </div>
          </div>

          {/* Wholesale Bulk Tier Slab Toggle */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-gray-900 flex items-center gap-1.5">
                  <Layers size={13} className="text-[#FF6B00]" />
                  <span>Wholesale Bulk Discount Slab (Optional)</span>
                </span>
                <span className="text-[10px] text-gray-500 block">
                  Reward bulk mandi orders with discounted per-unit pricing
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  id="variant-enable-tier-toggle"
                  checked={enableTierSlab}
                  onChange={(e) => setEnableTierSlab(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0F2C59]"></div>
              </label>
            </div>

            {enableTierSlab && (
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
                <div>
                  <label className="text-[10px] font-bold text-gray-600 block mb-1">
                    Min Quantity for Slab
                  </label>
                  <input
                    type="number"
                    min="2"
                    value={tierMinQty}
                    onChange={(e) => setTierMinQty(e.target.value)}
                    placeholder="e.g. 5"
                    className="w-full p-2 border border-gray-300 rounded-lg text-xs bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-600 block mb-1">
                    Slab Unit Price (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tierUnitPrice}
                    onChange={(e) => setTierUnitPrice(e.target.value)}
                    placeholder="e.g. 80"
                    className="w-full p-2 border border-gray-300 rounded-lg text-xs font-bold text-emerald-800 bg-white outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-gray-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              id="btn-cancel-add-variant"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-700 bg-gray-100 hover:bg-gray-200 font-bold transition text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-submit-add-variant"
              className="px-5 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] text-white font-bold transition text-xs flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
            >
              <Plus size={14} className="text-[#D4AF37]" />
              <span>+ Add Variant</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
