import React from 'react';
import { X, Clock, CheckCircle2, AlertTriangle, ChevronRight, Package, Truck, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { canCancelOrder, getRemainingCancellationMinutes } from '../lib/engine/checkout-calculator';
import {
  SIX_FULFILLMENT_STEPS,
  getFulfillmentStepIndex,
} from './OrderFulfillmentProgress';

interface CustomerOrdersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder: (order: Order) => void;
}

export const CustomerOrdersDrawer: React.FC<CustomerOrdersDrawerProps> = ({
  isOpen,
  onClose,
  onSelectOrder,
}) => {
  const { orders, currentUser } = useApp();

  if (!isOpen) return null;

  const customerOrders = orders.filter((o) => o.userId === currentUser.id);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between animate-slideLeft">
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex items-center justify-between border-b border-[#D4AF37]/30">
          <div>
            <h2 className="font-extrabold text-base text-[#D4AF37]">
              My Orders ({customerOrders.length})
            </h2>
            <p className="text-[11px] text-gray-300">Track fulfillment & 15-min cancellation</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Orders List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {customerOrders.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="text-4xl mb-2">📦</div>
              <h3 className="font-bold text-gray-700 text-sm">No Orders Placed Yet</h3>
              <p className="text-xs text-gray-500 mt-1">
                Your completed grocery orders will appear here for easy tracking.
              </p>
            </div>
          ) : (
            customerOrders.map((order) => {
              const isCancellable =
                order.status !== OrderStatus.CANCELLED &&
                order.status !== OrderStatus.DELIVERED &&
                canCancelOrder(order.createdAt);
              const remainingMins = getRemainingCancellationMinutes(order.createdAt);

              const stepIdx = getFulfillmentStepIndex(order.status);
              const matchedStep = stepIdx >= 0 ? SIX_FULFILLMENT_STEPS[stepIdx] : null;

              return (
                <div
                  key={order.id}
                  onClick={() => {
                    onSelectOrder(order);
                    onClose();
                  }}
                  className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl p-3.5 cursor-pointer transition flex flex-col justify-between space-y-2 hover:shadow-sm"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-1.5 font-bold text-xs text-[#0F2C59]">
                        <span>#{order.orderNumber}</span>
                        <span className="text-gray-400 font-normal">•</span>
                        <span className="text-[10px] text-gray-500 font-normal">
                          {new Date(order.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-600 mt-0.5">
                        {order.items.length} {order.items.length === 1 ? 'product' : 'products'} • {order.items[0]?.productName}
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        order.status === OrderStatus.CANCELLED
                          ? 'bg-red-100 text-red-800'
                          : order.status === OrderStatus.DELIVERED
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-[#FF6B00]/15 text-[#FF6B00]'
                      }`}
                    >
                      {order.status === OrderStatus.CANCELLED
                        ? 'Cancelled'
                        : matchedStep
                        ? matchedStep.label
                        : order.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {/* 6-Step Mini Progress Tracker */}
                  {order.status !== OrderStatus.CANCELLED && (
                    <div className="bg-white/80 p-2 rounded-lg border border-gray-200/80">
                      <div className="flex items-center justify-between text-[10px] font-bold text-gray-700 mb-1">
                        <span className="text-gray-500">Fulfillment:</span>
                        <span className="text-[#0F2C59] font-black">
                          Step {stepIdx + 1}/6 • {matchedStep?.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {SIX_FULFILLMENT_STEPS.map((s, i) => {
                          const isDone = i <= stepIdx;
                          const isCurr = i === stepIdx && order.status !== OrderStatus.DELIVERED;
                          return (
                            <div
                              key={s.key}
                              title={`Step ${s.stepNumber}: ${s.label}`}
                              className={`h-1.5 rounded-full transition-all ${
                                isDone
                                  ? isCurr
                                    ? 'bg-[#FF6B00] animate-pulse'
                                    : 'bg-emerald-500'
                                  : 'bg-gray-200'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isCancellable && (
                    <div className="bg-amber-100/70 border border-amber-300 text-amber-900 text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1">
                      <Clock size={12} className="text-amber-700 animate-spin" />
                      <span>{remainingMins} min left in 15-minute cancellation window!</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 text-xs">
                    <div>
                      <span className="text-gray-500 text-[10px]">Total: </span>
                      <span className="font-black text-[#0F2C59]">₹{order.finalAmount}</span>
                      <span className="text-[10px] text-gray-400 ml-1.5">
                        ({order.paymentMethod === PaymentMethod.ADVANCE_ONLINE ? 'UPI' : 'COD'})
                      </span>
                    </div>

                    <span className="text-[#0F2C59] font-bold text-[11px] flex items-center gap-0.5 hover:underline">
                      <span>Track Details</span>
                      <ChevronRight size={14} />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full bg-[#0F2C59] text-white py-2.5 rounded-xl text-xs font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
