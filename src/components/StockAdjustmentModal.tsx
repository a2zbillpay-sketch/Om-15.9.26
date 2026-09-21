import React, { useState, useEffect } from 'react';
import { X, Save, Boxes, Check, AlertCircle, RotateCcw, Plus, Minus } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { formatVariantPack } from '../utils/variantFormatter';

export interface StockAdjustmentModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveStock: (
    productId: string,
    updatedVariants: ProductVariant[]
  ) => Promise<{ success: boolean; error?: string }>;
  onOpenEditor?: (product: Product) => void;
}

interface VariantStockState {
  id: string;
  variant: ProductVariant;
  originalStock: number;
  newStock: number;
  inputStr: string;
  error?: string;
}

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  product,
  isOpen,
  onClose,
  onSaveStock,
  onOpenEditor,
}) => {
  const [variantStates, setVariantStates] = useState<VariantStockState[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (product && product.variants) {
      setVariantStates(
        product.variants.map((v) => {
          const currentStock = Math.max(0, Number(v.stockQuantity) || 0);
          return {
            id: v.id,
            variant: v,
            originalStock: currentStock,
            newStock: currentStock,
            inputStr: String(currentStock),
          };
        })
      );
      setSaveError(null);
      setSaveSuccess(false);
      setIsSaving(false);
    }
  }, [product, isOpen]);

  if (!isOpen || !product) return null;

  const handleStockInputChange = (index: number, val: string) => {
    setSaveError(null);
    setVariantStates((prev) => {
      const next = [...prev];
      const item = { ...next[index], inputStr: val };

      const trimmed = val.trim();
      if (trimmed === '') {
        item.error = 'Stock quantity cannot be empty.';
        item.newStock = 0;
      } else {
        const parsed = Number(trimmed);
        if (isNaN(parsed) || !Number.isInteger(parsed)) {
          item.error = 'Stock quantity must be a whole integer.';
        } else if (parsed < 0) {
          item.error = 'Stock quantity cannot be negative.';
        } else {
          item.error = undefined;
          item.newStock = parsed;
        }
      }

      next[index] = item;
      return next;
    });
  };

  const handleQuickAdjust = (index: number, delta: number) => {
    setSaveError(null);
    setVariantStates((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      const targetStock = Math.max(0, item.newStock + delta);
      item.newStock = targetStock;
      item.inputStr = String(targetStock);
      item.error = undefined;
      next[index] = item;
      return next;
    });
  };

  const handleResetVariant = (index: number) => {
    setSaveError(null);
    setVariantStates((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      item.newStock = item.originalStock;
      item.inputStr = String(item.originalStock);
      item.error = undefined;
      next[index] = item;
      return next;
    });
  };

  const handleSetZero = (index: number) => {
    setSaveError(null);
    setVariantStates((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      item.newStock = 0;
      item.inputStr = '0';
      item.error = undefined;
      next[index] = item;
      return next;
    });
  };

  const hasAnyError = variantStates.some((v) => Boolean(v.error));
  const hasChanges = variantStates.some((v) => v.newStock !== v.originalStock);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasAnyError) {
      setSaveError('Please resolve stock validation errors before saving.');
      return;
    }

    // Double-check all stock quantities are non-negative integers
    for (const item of variantStates) {
      if (item.newStock < 0 || !Number.isInteger(item.newStock)) {
        setSaveError('All stock quantities must be non-negative whole numbers.');
        return;
      }
    }

    setIsSaving(true);
    setSaveError(null);

    const updatedVariants: ProductVariant[] = product.variants.map((v) => {
      const match = variantStates.find((state) => state.id === v.id);
      return {
        ...v,
        stockQuantity: match ? match.newStock : v.stockQuantity,
      };
    });

    try {
      const result = await onSaveStock(product.id, updatedVariants);
      if (result.success) {
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
          onClose();
        }, 500);
      } else {
        setSaveError(result.error || 'Failed to update stock in inventory.');
      }
    } catch (err: any) {
      setSaveError(err?.message || 'Unexpected error occurred while updating stock.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      id="stock-adjustment-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        id="stock-adjustment-modal"
        className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden border border-gray-200 my-auto flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="bg-[#0F2C59] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-[#FF6B00] text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                <Boxes size={11} />
                <span>Stock Operations</span>
              </span>
              {product.barcode && (
                <span className="text-[11px] bg-white/10 text-[#D4AF37] font-mono px-2 py-0.5 rounded border border-white/20">
                  Barcode: {product.barcode}
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-base sm:text-lg text-white mt-1.5 truncate">
              <span className="text-[#D4AF37]">{product.brand}</span> — {product.name}
            </h3>
            <p className="text-[11px] text-gray-300 mt-0.5">
              Update inventory stock quantities for each pack size.
            </p>
          </div>
          <button
            type="button"
            id="close-stock-modal-btn"
            onClick={onClose}
            disabled={isSaving}
            className="text-gray-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition shrink-0 disabled:opacity-50"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {saveSuccess && (
            <div
              id="stock-save-success-banner"
              className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl flex items-center gap-2 font-bold animate-in fade-in duration-150"
            >
              <Check size={16} className="text-emerald-600 shrink-0" />
              <span>Inventory stock updated successfully!</span>
            </div>
          )}

          {saveError && (
            <div
              id="stock-save-error-banner"
              className="p-3 bg-red-50 border border-red-300 text-red-700 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold animate-in fade-in duration-150"
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-red-600 shrink-0" />
                <span>{saveError}</span>
              </div>
              <button
                type="button"
                onClick={() => setSaveError(null)}
                className="text-red-400 hover:text-red-700 p-0.5"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="space-y-3">
            {variantStates.map((state, idx) => {
              const v = state.variant;
              const delta = state.newStock - state.originalStock;

              let statusBadge = (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  In Stock ({state.originalStock})
                </span>
              );
              if (state.originalStock === 0) {
                statusBadge = (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700">
                    Out of Stock (0)
                  </span>
                );
              } else if (state.originalStock <= 10) {
                statusBadge = (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                    Low Stock ({state.originalStock})
                  </span>
                );
              }

              return (
                <div
                  key={state.id}
                  id={`stock-variant-row-${state.id}`}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-3 sm:p-4 space-y-3 transition"
                >
                  {/* Variant Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-gray-900">
                          {formatVariantPack(v)}
                        </span>
                        {statusBadge}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Base Selling Price: <span className="font-bold text-[#0F2C59]">₹{v.baseSellingPrice}</span> · MRP: ₹{v.mrp}
                      </div>
                    </div>

                    {/* Stock Delta indicator */}
                    <div className="text-right">
                      {delta !== 0 ? (
                        <span
                          className={`text-xs font-black px-2 py-0.5 rounded-md ${
                            delta > 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {delta > 0 ? `+${delta}` : delta} units
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400 font-medium">Unchanged</span>
                      )}
                    </div>
                  </div>

                  {/* Stock Input & Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                    <div className="sm:col-span-5">
                      <label className="text-[10px] font-bold text-gray-700 block mb-1">
                        New Stock Quantity <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          id={`stock-input-${state.id}`}
                          min="0"
                          step="1"
                          value={state.inputStr}
                          onChange={(e) => handleStockInputChange(idx, e.target.value)}
                          className={`w-full p-2 border rounded-lg text-sm font-bold bg-white outline-none ${
                            state.error
                              ? 'border-red-500 text-red-700 focus:ring-2 focus:ring-red-200'
                              : 'border-gray-300 text-gray-900 focus:border-[#0F2C59]'
                          }`}
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-medium pointer-events-none">
                          units
                        </span>
                      </div>
                    </div>

                    {/* Quick Adjustment Shortcuts */}
                    <div className="sm:col-span-7">
                      <label className="text-[10px] font-bold text-gray-600 block mb-1">
                        Quick Adjust Stock
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleQuickAdjust(idx, 5)}
                          className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md text-[11px] font-bold shadow-2xs transition active:scale-95 cursor-pointer"
                          title="Add 5 units"
                        >
                          +5
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickAdjust(idx, 10)}
                          className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md text-[11px] font-bold shadow-2xs transition active:scale-95 cursor-pointer"
                          title="Add 10 units"
                        >
                          +10
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickAdjust(idx, 25)}
                          className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md text-[11px] font-bold shadow-2xs transition active:scale-95 cursor-pointer"
                          title="Add 25 units"
                        >
                          +25
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickAdjust(idx, 50)}
                          className="px-2 py-1 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-md text-[11px] font-bold shadow-2xs transition active:scale-95 cursor-pointer"
                          title="Add 50 units"
                        >
                          +50
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQuickAdjust(idx, -5)}
                          disabled={state.newStock <= 0}
                          className="px-2 py-1 bg-white hover:bg-red-50 text-red-700 border border-red-200 rounded-md text-[11px] font-bold shadow-2xs transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                          title="Subtract 5 units"
                        >
                          -5
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetVariant(idx)}
                          disabled={state.newStock === state.originalStock}
                          className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-200 rounded transition disabled:opacity-30 disabled:pointer-events-none ml-auto"
                          title="Reset to original stock"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {state.error && (
                    <div className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                      <AlertCircle size={12} className="shrink-0" />
                      <span>{state.error}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-gray-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {onOpenEditor && (
                <button
                  type="button"
                  id="btn-stock-modal-open-editor"
                  onClick={() => {
                    onClose();
                    onOpenEditor(product);
                  }}
                  className="text-[11px] font-bold text-[#0F2C59] hover:text-[#FF6B00] transition flex items-center gap-1 cursor-pointer"
                  title="Open full product and pricing editor"
                >
                  <span>Open Full Product Editor &rarr;</span>
                </button>
              )}
              <div className="text-[11px] text-gray-500">
                {hasChanges ? (
                  <span className="font-semibold text-[#FF6B00]">Unsaved stock changes</span>
                ) : (
                  <span>Stock levels up-to-date</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                id="btn-cancel-stock-modal"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 rounded-xl text-gray-700 bg-gray-100 hover:bg-gray-200 font-bold transition text-xs disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="btn-save-stock-modal"
                disabled={isSaving || hasAnyError}
                className="px-5 py-2 rounded-xl bg-[#0F2C59] hover:bg-[#163a6e] text-white font-bold transition text-xs flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                <Save size={14} className="text-[#D4AF37]" />
                <span>{isSaving ? 'Saving...' : 'Save Stock Updates'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
