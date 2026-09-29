import React, { useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, Package, Calendar, User, Hash } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { formatVariantPack } from '../utils/variantFormatter';

export interface ProductRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  variant: ProductVariant | null;
  quantity: number;
  requestDate?: string;
  customerName?: string;
  customerPhone?: string;
}

export const ProductRequestModal: React.FC<ProductRequestModalProps> = ({
  isOpen,
  onClose,
  product,
  variant,
  quantity,
  requestDate,
  customerName,
  customerPhone,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !product || !variant) return null;

  const formattedDate = requestDate
    ? new Date(requestDate).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : new Date().toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-request-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#0F2C59] p-5 text-white flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-400/30">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <h3 id="product-request-modal-title" className="text-base font-extrabold text-white">
                Product Request Saved
              </h3>
              <p className="text-xs text-gray-300 font-medium mt-0.5">
                We have recorded your request for this item.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Out of Stock & Pricing Notice - EXACT REQUIRED COPY */}
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 text-xs text-amber-950 space-y-1 shadow-2xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 mb-1">
              <AlertTriangle size={15} className="text-amber-700 shrink-0" />
              <span>Availability & Price Policy</span>
            </div>
            <p className="font-semibold text-amber-900 text-xs leading-relaxed">
              This product is currently out of stock. The price may change when it becomes available. The current price is not guaranteed.
            </p>
          </div>

          {/* Request Summary Details Card */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-xs space-y-2.5">
            <div className="flex items-start justify-between gap-2 pb-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-[#FF6B00] shrink-0" />
                <span className="text-gray-600 font-medium">Item:</span>
              </div>
              <div className="text-right">
                <div className="font-bold text-gray-900">{product.name}</div>
                <div className="text-[11px] text-gray-500 font-medium">
                  {formatVariantPack(variant)}
                  {product.brand ? ` • ${product.brand}` : ''}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Hash size={14} className="text-blue-600 shrink-0" />
                <span className="text-gray-600 font-medium">Requested Quantity:</span>
              </div>
              <span className="font-extrabold text-[#0F2C59] bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                {quantity} {variant.unit || 'unit(s)'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-emerald-600 shrink-0" />
                <span className="text-gray-600 font-medium">Request Date:</span>
              </div>
              <span className="font-bold text-gray-800">{formattedDate}</span>
            </div>

            {(customerName || customerPhone) && (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-purple-600 shrink-0" />
                  <span className="text-gray-600 font-medium">Customer:</span>
                </div>
                <span className="font-bold text-gray-800">
                  {customerName || 'Customer'}
                  {customerPhone ? ` (${customerPhone})` : ''}
                </span>
              </div>
            )}
          </div>

          <div className="text-[11px] text-gray-500 text-center">
            No order was placed and no payment was deducted. We will notify you when fresh stock arrives.
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-2.5 bg-[#0F2C59] hover:bg-[#0b2245] text-white text-xs font-black rounded-xl transition cursor-pointer shadow-md"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
