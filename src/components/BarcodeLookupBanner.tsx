import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Edit3, Plus, X, Eye, EyeOff, Boxes } from 'lucide-react';
import { Product } from '../types';
import { BarcodeLookupMatchResult } from '../lib/product-service';
import { formatVariantPack } from '../utils/variantFormatter';

interface BarcodeLookupBannerProps {
  result: BarcodeLookupMatchResult | null;
  onClear: () => void;
  onOpenEditor: (product: Product) => void;
  onAddVariant: (product: Product) => void;
  onAddProductWithBarcode: (barcode: string) => void;
  onUpdateStock?: (product: Product) => void;
  onlyShowMatched?: boolean;
  onToggleOnlyShowMatched?: () => void;
}

export const BarcodeLookupBanner: React.FC<BarcodeLookupBannerProps> = ({
  result,
  onClear,
  onOpenEditor,
  onAddVariant,
  onAddProductWithBarcode,
  onUpdateStock,
  onlyShowMatched = false,
  onToggleOnlyShowMatched,
}) => {
  if (!result || result.status === 'empty') {
    return null;
  }

  // 1. EXACT SINGLE MATCH FOUND
  if (result.status === 'found' && result.product) {
    const product = result.product;
    return (
      <div
        id="barcode-lookup-found-banner"
        className="bg-emerald-50 border-2 border-emerald-400/80 rounded-2xl p-4 shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-200 space-y-3"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 shadow-2xs">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-md">
                  Exact Barcode Match
                </span>
                <span className="text-xs font-mono font-extrabold bg-white text-emerald-950 px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">
                  {result.normalizedBarcode}
                </span>
              </div>
              <h3 className="text-base font-extrabold text-gray-950 mt-1">
                <span className="text-[#FF6B00] font-black">{product.brand}</span> — {product.name}
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                {product.variants.length} pack size(s) available in catalog. Product card highlighted in inventory below.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
            {onToggleOnlyShowMatched && (
              <button
                type="button"
                id="lookup-toggle-filter-btn"
                onClick={onToggleOnlyShowMatched}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-emerald-100/60 text-emerald-900 border border-emerald-300 text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer"
                title={onlyShowMatched ? 'Show all products in catalog' : 'Isolate only this matched product'}
              >
                {onlyShowMatched ? <EyeOff size={13} /> : <Eye size={13} />}
                <span>{onlyShowMatched ? 'Show Full Catalog' : 'Isolate Matched Item'}</span>
              </button>
            )}

            {onUpdateStock && (
              <button
                type="button"
                id="lookup-update-stock-btn"
                onClick={() => onUpdateStock(product)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer"
                title={`Update Stock for ${product.name}`}
              >
                <Boxes size={13} />
                <span>Update Stock</span>
              </button>
            )}

            <button
              type="button"
              id="lookup-open-editor-btn"
              onClick={() => onOpenEditor(product)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F2C59] hover:bg-[#1a3f7a] text-white text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer"
              title={`Edit ${product.name}`}
            >
              <Edit3 size={13} className="text-[#D4AF37]" />
              <span>Open in Editor</span>
            </button>

            <button
              type="button"
              id="lookup-add-variant-btn"
              onClick={() => onAddVariant(product)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-100 text-[#0F2C59] border border-[#0F2C59]/40 text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer"
              title={`Add variant to ${product.name}`}
            >
              <Plus size={13} className="text-[#0F2C59]" />
              <span>+ Add Variant</span>
            </button>

            <button
              type="button"
              id="lookup-clear-btn"
              onClick={onClear}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-emerald-100/50 rounded-lg transition"
              title="Clear lookup result"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Existing Inventory Stock Breakdown */}
        <div className="pt-2.5 border-t border-emerald-200/80">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-bold text-emerald-950 uppercase tracking-wide flex items-center gap-1.5">
              <Boxes size={13} className="text-[#FF6B00]" />
              <span>Current Stock Levels ({product.variants.length} variant{product.variants.length > 1 ? 's' : ''})</span>
            </span>
            {onUpdateStock && (
              <button
                type="button"
                onClick={() => onUpdateStock(product)}
                className="text-[11px] font-bold text-[#FF6B00] hover:text-[#e05e00] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Adjust Quantities &rarr;</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {product.variants.map((v) => {
              const stock = Math.max(0, Number(v.stockQuantity) || 0);
              const isLow = stock > 0 && stock <= 10;
              const isOut = stock === 0;

              return (
                <div
                  key={v.id}
                  className="bg-white/90 border border-emerald-200/80 rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-2xs"
                >
                  <div className="min-w-0">
                    <div className="font-extrabold text-xs text-gray-900 truncate">
                      {formatVariantPack(v)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      ₹{v.baseSellingPrice} <span className="text-gray-400">(MRP ₹{v.mrp})</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block ${
                        isOut
                          ? 'bg-red-100 text-red-700 border border-red-200'
                          : isLow
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      {stock} {stock === 1 ? 'unit' : 'units'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 2. PRODUCT NOT FOUND
  if (result.status === 'not_found') {
    return (
      <div
        id="barcode-lookup-not-found-banner"
        className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 shadow-sm transition-all animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 shadow-2xs">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded-md">
                  Product Not Found
                </span>
                <span className="text-xs font-mono font-extrabold bg-white text-amber-950 px-2 py-0.5 rounded border border-amber-300 shadow-2xs">
                  {result.normalizedBarcode}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-gray-900 mt-1">
                No catalog product is registered with this barcode.
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                You can immediately create a new product entry with this barcode pre-filled into the form.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            {result.normalizedBarcode && (
              <button
                type="button"
                id="lookup-add-product-with-barcode-btn"
                onClick={() => onAddProductWithBarcode(result.normalizedBarcode!)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold rounded-xl shadow-sm transition active:scale-95 cursor-pointer"
                title="Open Add Product modal with this barcode pre-filled"
              >
                <Plus size={14} />
                <span>Add Product with this Barcode</span>
              </button>
            )}

            <button
              type="button"
              id="lookup-not-found-dismiss-btn"
              onClick={onClear}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-amber-100/50 rounded-lg transition"
              title="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. DUPLICATE DATA CONDITION (LEGACY DATA INTEGRITY ISSUE)
  if (result.status === 'duplicate_found' && result.duplicateProducts) {
    return (
      <div
        id="barcode-lookup-duplicate-banner"
        className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 shadow-sm space-y-3 transition-all animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0 shadow-2xs">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-red-900 bg-red-200/70 px-2 py-0.5 rounded-md">
                  Data Integrity Alert: Duplicate Barcode
                </span>
                <span className="text-xs font-mono font-extrabold bg-white text-red-950 px-2 py-0.5 rounded border border-red-300 shadow-2xs">
                  {result.normalizedBarcode}
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-red-950 mt-1">
                {result.duplicateProducts.length} products share this identical barcode in the catalog.
              </h3>
              <p className="text-xs text-red-800/90 mt-0.5 leading-relaxed">
                Because of legacy data, multiple items have the same barcode. The system will never silently choose or delete products automatically. Please review and edit the products below to ensure barcodes remain unique.
              </p>
            </div>
          </div>

          <button
            type="button"
            id="lookup-duplicate-dismiss-btn"
            onClick={onClear}
            className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-100/50 rounded-lg transition"
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-2 border-t border-red-200">
          {result.duplicateProducts.map((p) => (
            <div
              key={p.id}
              className="bg-white p-3 rounded-xl border border-red-200/80 shadow-2xs flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-bold text-[#FF6B00] uppercase block truncate">{p.brand}</span>
                <span className="text-xs font-bold text-gray-900 block truncate">{p.name}</span>
                <span className="text-[10px] text-gray-500 font-mono block">
                  {p.variants.length} variant(s) · ID: {p.id.slice(0, 8)}...
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenEditor(p)}
                className="px-2.5 py-1.5 bg-[#0F2C59] hover:bg-[#1a3f7a] text-white text-xs font-bold rounded-lg shrink-0 transition"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4. INVALID BARCODE FORMAT
  if (result.status === 'invalid') {
    return (
      <div
        id="barcode-lookup-invalid-banner"
        className="bg-red-50 border border-red-200 rounded-xl p-3 shadow-sm flex items-center justify-between gap-3 text-xs text-red-800"
      >
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-red-600 shrink-0" />
          <span>{result.error || 'Invalid barcode format. Barcode must contain standard printable characters.'}</span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-red-400 hover:text-red-700 p-1"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
};
