import React, { useState, useEffect } from 'react';
import { Check, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { useApp } from '../context/AppContext';

interface InlineVariantStockEditorProps {
  product: Product;
  variant: ProductVariant;
  threshold?: number;
  onSaveStock: (
    productId: string,
    updatedVariants: ProductVariant[]
  ) => Promise<{ success: boolean; error?: string }>;
}

export const InlineVariantStockEditor: React.FC<InlineVariantStockEditorProps> = ({
  product,
  variant,
  threshold: customThreshold,
  onSaveStock,
}) => {
  const { settings } = useApp();
  const threshold = customThreshold ?? product.lowStockThreshold ?? variant.lowStockThreshold ?? settings.lowStockThreshold ?? 10;
  const currentStock = Math.max(0, Number(variant.stockQuantity) || 0);
  const [stockInput, setStockInput] = useState<string>(String(currentStock));
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setStockInput(String(Math.max(0, Number(variant.stockQuantity) || 0)));
  }, [variant.stockQuantity]);

  const parsedVal = Number(stockInput.trim());
  const isValidNumber =
    stockInput.trim() !== '' &&
    !isNaN(parsedVal) &&
    Number.isInteger(parsedVal) &&
    parsedVal >= 0;
  const isChanged = isValidNumber && parsedVal !== currentStock;

  const isOutOfStock = currentStock === 0;
  const isLowStock = !isOutOfStock && currentStock <= threshold;

  const handleSave = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!isValidNumber) {
      setStatus('error');
      setErrorMessage('Enter a whole non-negative number');
      setTimeout(() => setStatus('idle'), 3000);
      return;
    }

    setIsSaving(true);
    setStatus('idle');
    setErrorMessage(null);

    const updatedVariants: ProductVariant[] = product.variants.map((v) =>
      v.id === variant.id ? { ...v, stockQuantity: parsedVal } : v
    );

    try {
      const res = await onSaveStock(product.id, updatedVariants);
      if (res.success) {
        setStatus('success');
        setTimeout(() => setStatus('idle'), 2000);
      } else {
        setStatus('error');
        setErrorMessage(res.error || 'Failed to save');
        setTimeout(() => setStatus('idle'), 3500);
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Failed to save');
      setTimeout(() => setStatus('idle'), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="flex items-center gap-1">
        <span className="font-semibold text-gray-600">Stock:</span>
        <div className="relative flex items-center">
          <input
            type="number"
            min="0"
            id={`variant-stock-input-${variant.id}`}
            value={stockInput}
            onChange={(e) => {
              setStockInput(e.target.value);
              setStatus('idle');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              }
            }}
            disabled={isSaving}
            className={`w-16 px-1.5 py-0.5 text-xs font-bold bg-white border rounded-md outline-none transition text-center ${
              isChanged
                ? 'border-[#FF6B00] ring-1 ring-[#FF6B00]/40 bg-orange-50/40 text-gray-900'
                : isOutOfStock
                ? 'border-red-300 bg-red-50/30 text-red-700 focus:border-red-500'
                : isLowStock
                ? 'border-amber-300 bg-amber-50/30 text-amber-900 focus:border-amber-500'
                : 'border-gray-300 focus:border-[#0F2C59] text-gray-900'
            }`}
            title="Edit stock quantity and press Enter or click Save"
          />
          <span className="text-[10px] text-gray-500 ml-1">units</span>
        </div>
      </div>

      {/* Low-Stock / Out-of-Stock Warning Badge on the Variant */}
      {!isChanged && isOutOfStock && (
        <span
          id={`variant-out-of-stock-badge-${variant.id}`}
          className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-700 bg-red-100/90 px-1.5 py-0.5 rounded border border-red-200 shadow-2xs"
          title="Stock depleted: 0 units"
        >
          <AlertCircle size={10} className="text-red-600 shrink-0" />
          <span>Out of stock</span>
        </span>
      )}

      {!isChanged && isLowStock && (
        <span
          id={`variant-low-stock-badge-${variant.id}`}
          className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-900 bg-amber-100/90 px-1.5 py-0.5 rounded border border-amber-300 shadow-2xs"
          title={`Low stock alert: ${currentStock} units left (Threshold: ${threshold})`}
        >
          <AlertTriangle size={10} className="text-amber-600 shrink-0 animate-pulse" />
          <span>Low stock ({currentStock})</span>
        </span>
      )}

      {isChanged && (
        <button
          type="button"
          id={`variant-stock-save-btn-${variant.id}`}
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0F2C59] hover:bg-[#163a6e] text-white text-[10px] font-bold rounded shadow-2xs transition active:scale-95 cursor-pointer disabled:opacity-50"
          title="Save new stock quantity"
        >
          {isSaving ? (
            <Loader2 size={11} className="animate-spin text-[#D4AF37]" />
          ) : (
            <Check size={11} className="text-[#D4AF37]" />
          )}
          <span>Save</span>
        </button>
      )}

      {status === 'success' && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
          <Check size={11} className="text-emerald-600" />
          <span>Saved</span>
        </span>
      )}

      {status === 'error' && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
          <AlertCircle size={11} className="text-red-500" />
          <span>{errorMessage || 'Error'}</span>
        </span>
      )}
    </div>
  );
};
