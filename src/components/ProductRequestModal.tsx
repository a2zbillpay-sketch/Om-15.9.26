import React, { useEffect } from 'react';
import { X, CheckCircle2, Package, Calendar, User, Hash } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { formatVariantPack } from '../utils/variantFormatter';

export interface ProductRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
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
  onAccept,
  onDecline,
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

  const handleAccept = () => {
    if (onAccept) {
      onAccept();
    } else {
      onClose();
    }
  };

  const handleDecline = () => {
    if (onDecline) {
      onDecline();
    } else {
      onClose();
    }
  };

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
          {/* Out of Stock Confirmation Notice - Red Box with Blue Bold Text */}
          <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4 text-xs sm:text-sm space-y-2.5 shadow-xs">
            <p className="font-bold text-blue-700 leading-relaxed">
              तुम्ही ऑर्डर करत असलेले हे प्रॉडक्ट सध्या उपलब्ध नाही. तुमच्या विनंतीनुसार ते उपलब्ध करून देऊ. किमतीत होणारा बदल तुम्हाला मान्य असेल तर “मान्य आहे” वर क्लिक करा.
            </p>
            <p className="font-bold text-blue-700 leading-relaxed">
              ऑर्डर केलेली वस्तू कोणत्याही कारणास्तव रद्द करता येणार नाही. तसेच वस्तू खराब नसल्यास ती बदलून दिली जाणार नाही.
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
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleAccept}
              className="w-full sm:w-auto px-6 py-2.5 bg-[#0F2C59] hover:bg-[#0b2245] text-white text-xs font-black rounded-xl transition cursor-pointer shadow-md text-center"
            >
              मान्य आहे
            </button>
            <button
              type="button"
              onClick={handleDecline}
              className="w-full sm:w-auto px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition cursor-pointer border border-gray-300 shadow-2xs text-center"
            >
              अमान्य
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
