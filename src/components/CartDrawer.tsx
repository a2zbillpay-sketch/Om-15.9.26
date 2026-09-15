import React from 'react';
import { X, Trash2, Plus, Minus, ArrowRight, ShieldCheck, Truck, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getActiveUnitPrice } from '../lib/engine/checkout-calculator';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onProceedToCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  onProceedToCheckout,
}) => {
  const { cart, updateCartQty, removeFromCart, clearCart, checkoutBreakdown, settings } = useApp();

  if (!isOpen) return null;

  const freeShippingNeeded = Math.max(
    0,
    settings.freeShippingMinAmount - checkoutBreakdown.subtotal
  );

  const freeShippingProgress = Math.min(
    100,
    (checkoutBreakdown.subtotal / settings.freeShippingMinAmount) * 100
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between animate-slideLeft">
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex items-center justify-between border-b border-[#D4AF37]/30">
          <div className="flex items-center gap-2">
            <h2 className="font-extrabold text-base tracking-wide text-[#D4AF37]">
              Shopping Cart ({cart.length})
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-[11px] text-gray-300 hover:text-red-300 flex items-center gap-1 font-medium transition"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
              aria-label="Close cart"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Free Delivery Threshold Bar */}
        <div className="bg-amber-50 p-3 border-b border-amber-200">
          <div className="flex items-center justify-between text-xs font-bold text-amber-900 mb-1.5">
            <div className="flex items-center gap-1.5">
              <Truck size={14} className="text-[#FF6B00]" />
              {freeShippingNeeded > 0 ? (
                <span>
                  Add <span className="text-emerald-700 font-extrabold">₹{freeShippingNeeded}</span> more for <span className="text-emerald-700 font-extrabold">FREE Delivery</span>!
                </span>
              ) : (
                <span className="text-emerald-700 font-extrabold flex items-center gap-1">
                  🎉 You unlocked FREE Delivery!
                </span>
              )}
            </div>
            <span className="text-[10px] text-gray-500">Threshold: ₹{settings.freeShippingMinAmount}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#FF6B00] h-full rounded-full transition-all duration-300"
              style={{ width: `${freeShippingProgress}%` }}
            />
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-gray-100">
          {cart.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                🛒
              </div>
              <h3 className="font-bold text-gray-700 text-sm">Your Cart is Empty</h3>
              <p className="text-xs text-gray-500 mt-1">
                Explore our wholesale groceries and necessities to add items.
              </p>
              <button
                onClick={onClose}
                className="mt-4 bg-[#0F2C59] text-white text-xs font-bold px-4 py-2 rounded-xl"
              >
                Browse Products
              </button>
            </div>
          ) : (
            cart.map((item) => {
              const activePrice = getActiveUnitPrice(
                item.variant.baseSellingPrice,
                item.quantity,
                item.variant.tieredPrices || []
              );
              const itemTotal = activePrice * item.quantity;
              const hasTierDiscount = activePrice < item.variant.baseSellingPrice;

              return (
                <div key={item.variantId} className="pt-3 first:pt-0 flex gap-3 items-center">
                  <img
                    src={item.product.imageUrl}
                    alt={item.product.name}
                    className="w-16 h-16 rounded-xl object-cover border border-gray-200 shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-gray-900 truncate">
                      {item.product.name}
                    </h4>
                    <p className="text-[11px] text-gray-500">
                      {item.variant.packLabel || `${item.variant.packSize} ${item.variant.unit}`}
                    </p>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-black text-[#0F2C59]">
                        ₹{activePrice}
                      </span>
                      {hasTierDiscount && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded">
                          Bulk Tier Applied
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="flex items-center bg-gray-100 border border-gray-300 rounded-lg">
                      <button
                        onClick={() => updateCartQty(item.variantId, item.quantity - 1)}
                        className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 text-gray-700 transition"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-xs font-bold text-gray-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateCartQty(item.variantId, item.quantity + 1)}
                        disabled={item.quantity >= item.variant.maxOrderLimit}
                        className="w-6 h-6 flex items-center justify-center hover:bg-gray-200 text-gray-700 transition disabled:opacity-30"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <span className="text-xs font-black text-gray-900">
                      ₹{itemTotal}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer & Bill Breakdown */}
        {cart.length > 0 && (
          <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-3">
            {/* Advance Payment Promo Banner */}
            <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-emerald-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} className="text-emerald-600 shrink-0" />
                <span>
                  Save extra <strong className="text-emerald-700 font-black">₹{checkoutBreakdown.advanceDiscountAmount}</strong> with Advance Online UPI!
                </span>
              </div>
              <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
            </div>

            {/* Breakdown Summary */}
            <div className="space-y-1 text-xs text-gray-600 border-t border-gray-200 pt-2">
              <div className="flex justify-between">
                <span>Items Subtotal:</span>
                <span className="font-bold text-gray-900">₹{checkoutBreakdown.subtotal}</span>
              </div>
              <div className="flex justify-between">
                <span>Delivery Fee:</span>
                <span>
                  {checkoutBreakdown.deliveryFee === 0 ? (
                    <span className="text-emerald-600 font-bold">FREE</span>
                  ) : (
                    `₹${checkoutBreakdown.deliveryFee}`
                  )}
                </span>
              </div>
              <div className="flex justify-between text-emerald-700 font-bold">
                <span>Advance UPI Payable:</span>
                <span className="text-sm font-black text-emerald-800">
                  ₹{checkoutBreakdown.advanceFinalTotal}
                </span>
              </div>
              <div className="flex justify-between text-gray-500 text-[11px]">
                <span>COD Total (after door delivery):</span>
                <span>₹{checkoutBreakdown.codFinalTotal}</span>
              </div>
            </div>

            {/* Checkout Button */}
            <button
              id="proceed-to-checkout-btn"
              onClick={onProceedToCheckout}
              className="w-full bg-[#0F2C59] hover:bg-[#153e7d] text-white p-3.5 rounded-xl font-extrabold text-sm flex items-center justify-between shadow-lg transition hover:scale-[1.01]"
            >
              <div>
                <div className="text-[10px] text-[#D4AF37] font-medium leading-none">
                  SELECT PAYMENT & ADDRESS
                </div>
                <div className="text-base font-black leading-tight text-white">
                  Proceed to Checkout
                </div>
              </div>
              <div className="bg-[#D4AF37] text-[#0F2C59] p-1.5 rounded-lg">
                <ArrowRight size={18} />
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
