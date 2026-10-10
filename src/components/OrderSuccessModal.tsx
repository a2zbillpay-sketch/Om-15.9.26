import React from 'react';
import { CheckCircle2, Clock, Package, MapPin, Calendar, CreditCard, ChevronRight } from 'lucide-react';
import { Order, PaymentMethod } from '../types';

export interface OrderSuccessModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
}

export const OrderSuccessModal: React.FC<OrderSuccessModalProps> = ({
  order,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !order) return null;

  return (
    <div
      id="order-success-confirmation-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-success-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fadeIn"
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-gray-200 my-auto text-center transform transition-all animate-scaleUp">
        {/* Top Decorative Header */}
        <div className="bg-gradient-to-b from-emerald-50 to-white pt-8 pb-4 px-6 flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 border-2 border-emerald-400/80 flex items-center justify-center text-emerald-600 mb-3 shadow-inner">
            <CheckCircle2 size={38} className="stroke-[2.5]" />
          </div>

          <h2
            id="order-success-title"
            className="text-xl sm:text-2xl font-black text-[#0F2C59] tracking-tight"
          >
            Order Placed Successfully!
          </h2>

          <p className="text-xs sm:text-sm text-gray-600 font-medium mt-1">
            Your order has been placed successfully.
          </p>

          {/* Exact Status Requirement */}
          <div className="mt-3.5 inline-flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-900 px-4 py-1.5 rounded-full text-xs font-black shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <Clock size={13} className="text-amber-600 shrink-0" />
            <span>Order Status: Pending</span>
          </div>
        </div>

        {/* Order Details Brief Card */}
        <div className="px-6 pb-2 text-left">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex justify-between items-center pb-2 border-b border-gray-200 font-bold">
              <span className="text-gray-500">Order Reference:</span>
              <span className="font-mono text-sm font-extrabold text-[#0F2C59]">
                #{order.orderNumber}
              </span>
            </div>

            <div className="flex justify-between items-center text-gray-700">
              <span className="text-gray-500 flex items-center gap-1">
                <Package size={13} className="text-gray-400" />
                <span>Total Items:</span>
              </span>
              <span className="font-semibold">{order.items?.length || 0} product(s)</span>
            </div>

            <div className="flex justify-between items-center text-gray-700">
              <span className="text-gray-500 flex items-center gap-1">
                <CreditCard size={13} className="text-gray-400" />
                <span>Payment:</span>
              </span>
              <span className="font-bold text-[#0F2C59]">
                {order.paymentMethod === PaymentMethod.ADVANCE_ONLINE
                  ? 'UPI Advance (Paid)'
                  : 'Cash on Delivery (COD)'}
              </span>
            </div>

            <div className="flex justify-between items-center text-gray-700">
              <span className="text-gray-500 flex items-center gap-1">
                <Calendar size={13} className="text-gray-400" />
                <span>Delivery Date:</span>
              </span>
              <span className="font-semibold text-gray-800">{order.deliveryDate || 'Scheduled'}</span>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-gray-200 font-black text-sm">
              <span className="text-gray-800">Final Bill:</span>
              <span className="text-emerald-700 font-mono">₹{order.finalAmount}</span>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 text-center mt-3">
            Shopkeeper will review your order shortly. You can track live updates in My Orders.
          </p>
        </div>

        {/* Action Button: OK */}
        <div className="p-6 pt-3">
          <button
            type="button"
            id="btn-order-success-ok"
            onClick={onClose}
            className="w-full bg-[#0F2C59] hover:bg-[#163a6e] text-white font-extrabold text-sm py-3 px-6 rounded-xl shadow-md transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span>OK</span>
          </button>
        </div>
      </div>
    </div>
  );
};
