import React from 'react';
import { ShieldCheck, Truck, ArrowRight, Percent } from 'lucide-react';
import { CheckoutBreakdown } from '../lib/engine/checkout-calculator';

interface DualPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  breakdown: CheckoutBreakdown;
  onSelectPayment: (method: 'COD' | 'ADVANCE_ONLINE') => void;
}

export const DualPaymentModal: React.FC<DualPaymentModalProps> = ({
  isOpen,
  onClose,
  breakdown,
  onSelectPayment,
}) => {
  if (!isOpen) return null;

  const totalSavings =
    breakdown.codFinalTotal - breakdown.advanceFinalTotal;

  return (
    <div
      id="dual-payment-modal"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fadeIn"
    >
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl border-t-4 border-[#D4AF37] max-h-[90vh] overflow-y-auto">
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
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>Advance Discount:</span>
                  <span>-₹{breakdown.advanceDiscountAmount}</span>
                </div>
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

            {totalSavings > 0 && (
              <div className="mt-2 text-center bg-emerald-100/80 text-emerald-800 text-[10px] font-extrabold py-0.5 px-2 rounded">
                You Save ₹{totalSavings} vs COD!
              </div>
            )}
          </div>

          {/* Option 2: Cash on Delivery */}
          <div
            id="select-cod-payment-btn"
            onClick={() => onSelectPayment('COD')}
            className="bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between hover:shadow-md"
          >
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Truck className="text-gray-700" size={20} />
                <span className="font-bold text-[#0F2C59] text-sm">Cash On Delivery</span>
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
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-200 flex justify-between items-center">
              <div>
                <span className="text-[11px] font-bold text-gray-500 block">Payable Amount:</span>
                <span className="text-lg font-black text-[#0F2C59]">₹{breakdown.codFinalTotal}</span>
              </div>
              <span className="bg-gray-400 text-white p-1.5 rounded-full">
                <ArrowRight size={14} />
              </span>
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
