import React, { useState, useEffect } from 'react';
import { ShieldCheck, Truck, ArrowRight, Percent, CheckCircle2 } from 'lucide-react';
import { CheckoutBreakdown } from '../lib/engine/checkout-calculator';

interface DualPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  breakdown: CheckoutBreakdown;
  onSelectPayment: (method: 'COD' | 'ADVANCE_ONLINE') => void | Promise<void>;
}

export const DualPaymentModal: React.FC<DualPaymentModalProps> = ({
  isOpen,
  onClose,
  breakdown,
  onSelectPayment,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<'COD' | 'ADVANCE_ONLINE' | null>(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedMethod(null);
      setIsPlacingOrder(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalSavings =
    breakdown.codFinalTotal - breakdown.advanceFinalTotal;

  const handleCardClick = () => {
    // Tapping/clicking the COD card container ONLY selects or highlights COD.
    // It strictly does NOT create or place an order.
    setSelectedMethod('COD');
  };

  const handleConfirmCodOrder = async (e: React.MouseEvent) => {
    // ONLY clicking the explicit "Confirm COD Order" button triggers order creation.
    e.stopPropagation();
    if (isPlacingOrder) return;
    setIsPlacingOrder(true);
    try {
      await onSelectPayment('COD');
    } catch (err) {
      console.error('Failed to create COD order:', err);
      setIsPlacingOrder(false);
    }
  };

  return (
    <div
      id="dual-payment-modal"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn"
      onClick={(e) => {
        // Prevent accidental backdrop touches from performing any unintended action
        if (e.target === e.currentTarget) {
          e.stopPropagation();
        }
      }}
    >
      <div
        id="dual-payment-modal-content"
        className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl border-t-4 border-[#D4AF37] max-h-[90vh] overflow-y-auto"
      >
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-amber-900 text-xs font-bold mb-2">
            <Percent size={13} className="text-[#FF6B00]" />
            <span>Instant Advance Discount Offer</span>
          </div>
          <h2 className="text-xl font-extrabold text-[#0F2C59]">Choose Payment Option</h2>
          <p className="text-xs text-gray-500 mt-1">Compare savings before placing your order</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Option 1: Advance Online */}
          <div
            id="select-advance-payment-btn"
            onClick={() => onSelectPayment('ADVANCE_ONLINE')}
            className="relative bg-emerald-50/70 hover:bg-emerald-50 border-2 border-emerald-500 rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between shadow-sm hover:shadow-md hover:scale-[1.02]"
          >
            <div className="absolute -top-3 right-3 bg-emerald-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
              Best Savings
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="text-emerald-600" size={20} />
                <span className="font-bold text-[#0F2C59] text-sm">Advance Payment</span>
              </div>
              <p className="text-[11px] text-gray-600 mb-3">Pay via UPI / QR / Netbanking instantly</p>

              <div className="space-y-1.5 text-xs text-gray-700 border-t border-emerald-200/60 pt-2.5">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>₹{breakdown.subtotal}</span>
                </div>
                {breakdown.excludedSubtotal > 0 && breakdown.eligibleSubtotal > 0 && (
                  <>
                    <div className="flex justify-between text-[11px] text-gray-500 pl-1.5">
                      <span>• Eligible Items:</span>
                      <span>₹{breakdown.eligibleSubtotal}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-amber-800 pl-1.5 font-medium">
                      <span>• Price Regulated:</span>
                      <span>₹{breakdown.excludedSubtotal}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>Advance Discount:</span>
                  <span>{breakdown.advanceDiscountAmount > 0 ? `-₹${breakdown.advanceDiscountAmount}` : '₹0'}</span>
                </div>
                {breakdown.advanceDiscountAmount > 0 && breakdown.excludedSubtotal > 0 && (
                  <div className="text-[10px] text-gray-500 italic pl-1">
                    (Applied only to ₹{breakdown.eligibleSubtotal} eligible items)
                  </div>
                )}
                {breakdown.advanceDiscountAmount === 0 && breakdown.excludedSubtotal > 0 && (
                  <div className="text-[10px] text-amber-800 italic pl-1">
                    (No discount: items are Price Regulated)
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Delivery Fee:</span>
                  <span>{breakdown.deliveryFee === 0 ? <span className="text-emerald-600 font-bold">FREE</span> : `₹${breakdown.deliveryFee}`}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-emerald-200 flex justify-between items-center">
              <div>
                <span className="text-[11px] font-bold text-gray-500 block">Payable Amount:</span>
                <span className="text-lg font-black text-emerald-700">₹{breakdown.advanceFinalTotal}</span>
              </div>
              <span className="bg-emerald-600 text-white p-1.5 rounded-full">
                <ArrowRight size={14} />
              </span>
            </div>

            {totalSavings > 0 ? (
              <div className="mt-2 text-center bg-emerald-100/80 text-emerald-800 text-[10px] font-extrabold py-0.5 px-2 rounded">
                You Save ₹{totalSavings} vs COD!
              </div>
            ) : breakdown.excludedSubtotal > 0 ? (
              <div className="mt-2 text-center bg-amber-100 text-amber-900 text-[10px] font-bold py-0.5 px-2 rounded">
                Regulated Pricing (Price Unchanged)
              </div>
            ) : null}
          </div>

          {/* Option 2: Cash on Delivery */}
          <div
            id="cod-payment-option-card"
            onClick={handleCardClick}
            className={`relative rounded-xl p-4 transition-all flex flex-col justify-between cursor-pointer border-2 ${
              selectedMethod === 'COD'
                ? 'bg-amber-50/40 border-[#0F2C59] ring-2 ring-[#0F2C59]/20 shadow-md'
                : 'bg-gray-50/80 hover:bg-gray-100 border-gray-300 hover:border-gray-400'
            }`}
          >
            {selectedMethod === 'COD' && (
              <div className="absolute -top-3 right-3 bg-[#0F2C59] text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                <CheckCircle2 size={11} className="text-[#D4AF37]" />
                <span>Selected</span>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Truck className={selectedMethod === 'COD' ? 'text-[#0F2C59]' : 'text-gray-700'} size={20} />
                  <span className="font-bold text-[#0F2C59] text-sm">Cash On Delivery</span>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    selectedMethod === 'COD'
                      ? 'border-[#0F2C59] bg-[#0F2C59]'
                      : 'border-gray-400 bg-white'
                  }`}
                >
                  {selectedMethod === 'COD' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </div>

              <p className="text-[11px] text-gray-600 mb-3">Pay cash or UPI to driver at doorstep</p>

              <div className="space-y-1.5 text-xs text-gray-700 border-t border-gray-200 pt-2.5">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>₹{breakdown.subtotal}</span>
                </div>
                <div className="flex justify-between text-amber-800">
                  <span>COD Charge:</span>
                  <span>{breakdown.codCharge === 0 ? <span className="text-emerald-600 font-bold">FREE (First 3 Orders)</span> : `+₹${breakdown.codCharge}`}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Delivery Fee:</span>
                  <span>{breakdown.deliveryFee === 0 ? <span className="text-emerald-600 font-bold">FREE</span> : `₹${breakdown.deliveryFee}`}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-800 pt-1 border-t border-gray-100">
                  <span>New Order Amount:</span>
                  <span>₹{breakdown.codFinalTotal}</span>
                </div>
              </div>

              {breakdown.previousOutstanding && breakdown.previousOutstanding > 0 ? (
                <div className="bg-amber-50/90 border border-amber-200 rounded-lg p-2.5 mt-2.5 space-y-1 text-xs">
                  <div className="flex justify-between text-gray-700">
                    <span>Previous Outstanding:</span>
                    <span className="font-extrabold text-amber-900">+₹{breakdown.previousOutstanding}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>+ New Order Amount:</span>
                    <span className="font-extrabold text-gray-900">₹{breakdown.codFinalTotal}</span>
                  </div>
                  <div className="border-t border-amber-300 pt-1 flex justify-between font-black text-xs text-[#0F2C59]">
                    <span>= Total Payable:</span>
                    <span className="text-sm font-black">
                      ₹{breakdown.codTotalPayable ?? (breakdown.codFinalTotal + breakdown.previousOutstanding)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <div className="mt-4 pt-3 border-t border-gray-200 flex justify-between items-center">
                <div>
                  <span className="text-[11px] font-bold text-gray-500 block">Total Payable:</span>
                  <span className="text-lg font-black text-[#0F2C59]">
                    ₹{breakdown.codTotalPayable ?? (breakdown.codFinalTotal + (breakdown.previousOutstanding || 0))}
                  </span>
                  {breakdown.previousOutstanding && breakdown.previousOutstanding > 0 ? (
                    <span className="text-[9px] text-amber-800 font-bold block">
                      (Includes ₹{breakdown.previousOutstanding} previous balance)
                    </span>
                  ) : null}
                </div>
                {selectedMethod === 'COD' ? (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                    Pay at Doorstep
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
                    Tap to Select
                  </span>
                )}
              </div>

              {/* Explicit Confirm COD Order Button or Selection Prompt */}
              <div className="mt-3">
                {selectedMethod === 'COD' ? (
                  <button
                    id="confirm-cod-order-btn"
                    type="button"
                    disabled={isPlacingOrder}
                    onClick={handleConfirmCodOrder}
                    className="w-full py-3 px-4 bg-[#0F2C59] hover:bg-[#153e7d] active:scale-[0.99] text-white font-extrabold text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} className="text-[#D4AF37]" />
                    <span>{isPlacingOrder ? 'Placing Order...' : 'Confirm COD Order'}</span>
                  </button>
                ) : (
                  <div className="w-full py-2.5 px-3 text-center bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition">
                    <span>Tap to Select COD</span>
                    <ArrowRight size={13} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          id="close-payment-modal-btn"
          onClick={onClose}
          className="w-full text-center text-xs text-gray-500 font-bold py-2 hover:underline hover:text-gray-800"
        >
          Go Back to Cart
        </button>
      </div>
    </div>
  );
};
