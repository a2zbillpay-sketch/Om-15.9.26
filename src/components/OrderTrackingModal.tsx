import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Truck,
  PackageCheck,
  Package,
  Calendar,
  MapPin,
  FileText,
} from 'lucide-react';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { useApp } from '../context/AppContext';
import { canCancelOrder } from '../lib/engine/checkout-calculator';
import {
  OrderFulfillmentProgress,
  SIX_FULFILLMENT_STEPS,
  getFulfillmentStepIndex,
} from './OrderFulfillmentProgress';

interface OrderTrackingModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
}

export const OrderTrackingModal: React.FC<OrderTrackingModalProps> = ({
  order,
  isOpen,
  onClose,
}) => {
  const { orders, cancelOrder, currentUser } = useApp();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  // Automatically sync with latest order state from AppContext
  const currentOrder = (order && orders.find((o) => o.id === order.id)) || order;

  useEffect(() => {
    if (!currentOrder) return;

    const calculateTimeLeft = () => {
      const orderTime = new Date(currentOrder.createdAt).getTime();
      const windowMs = 15 * 60 * 1000;
      const elapsed = Date.now() - orderTime;
      const remaining = Math.max(0, Math.floor((windowMs - elapsed) / 1000));
      setSecondsRemaining(remaining);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [currentOrder]);

  if (!isOpen || !currentOrder) return null;

  const isCancellable =
    currentOrder.status !== OrderStatus.CANCELLED &&
    currentOrder.status !== OrderStatus.DELIVERED &&
    secondsRemaining > 0;

  const minutesLeft = Math.floor(secondsRemaining / 60);
  const secondsLeft = secondsRemaining % 60;

  const handleCancel = () => {
    const success = cancelOrder(currentOrder.id);
    if (success) {
      setCancelMessage(
        currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE
          ? 'Order cancelled! ₹' + currentOrder.finalAmount + ' has been refunded directly to your Store Wallet.'
          : 'Order successfully cancelled.'
      );
    }
  };

  const stepIndex = getFulfillmentStepIndex(currentOrder.status);
  const matchedStep = stepIndex >= 0 ? SIX_FULFILLMENT_STEPS[stepIndex] : null;

  return (
    <div
      id="order-tracking-modal"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn"
    >
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border-t-4 border-[#0F2C59] max-h-[92vh] flex flex-col justify-between">
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-extrabold text-base text-[#D4AF37]">
                Order #{currentOrder.orderNumber}
              </h2>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  currentOrder.status === OrderStatus.CANCELLED
                    ? 'bg-red-500 text-white'
                    : currentOrder.status === OrderStatus.DELIVERED
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[#FF6B00] text-white'
                }`}
              >
                {currentOrder.status === OrderStatus.CANCELLED
                  ? 'Cancelled'
                  : matchedStep
                  ? matchedStep.label
                  : currentOrder.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-[11px] text-gray-300">
              Placed on {new Date(currentOrder.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(currentOrder.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-gray-300 hover:text-white transition"
            aria-label="Close Order Details"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* 6-Step Order Fulfillment Progress Timeline */}
          <OrderFulfillmentProgress
            status={currentOrder.status}
            orderNumber={currentOrder.orderNumber}
          />

          {/* 15-Minute Cancellation Window Banner */}
          {currentOrder.status !== OrderStatus.CANCELLED && (
            <div
              className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs ${
                isCancellable
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <div className="flex items-start gap-2">
                <Clock
                  size={18}
                  className={`mt-0.5 shrink-0 ${
                    isCancellable ? 'text-amber-600 animate-pulse' : 'text-gray-400'
                  }`}
                />
                <div>
                  <div className="font-extrabold">
                    {isCancellable
                      ? '15-Minute Instant Cancellation Window Active'
                      : 'Cancellation Window Closed'}
                  </div>
                  <div className="text-[11px] mt-0.5">
                    {isCancellable ? (
                      <span>
                        You can cancel within{' '}
                        <strong className="font-mono text-xs font-black text-amber-950">
                          {String(minutesLeft).padStart(2, '0')}:{String(secondsLeft).padStart(2, '0')}
                        </strong>{' '}
                        minutes.
                      </span>
                    ) : (
                      <span>Wholesale batch has entered automated packing & logistics.</span>
                    )}
                  </div>
                </div>
              </div>

              {isCancellable && (
                <button
                  id="cancel-order-btn"
                  onClick={handleCancel}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg shrink-0 shadow-sm transition"
                >
                  Cancel Order
                </button>
              )}
            </div>
          )}

          {cancelMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl font-semibold">
              {cancelMessage}
            </div>
          )}

          {/* Delivery & Recipient Details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
              <div className="text-gray-500 font-bold flex items-center gap-1 mb-1">
                <MapPin size={12} className="text-[#FF6B00]" />
                <span>Delivery Address</span>
              </div>
              <p className="font-semibold text-gray-800">{currentOrder.address.fullAddress}</p>
              <p className="text-[11px] text-gray-500">Pincode: {currentOrder.address.pincode}</p>
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
              <div className="text-gray-500 font-bold flex items-center gap-1 mb-1">
                <Calendar size={12} className="text-[#0F2C59]" />
                <span>Scheduled Date</span>
              </div>
              <p className="font-semibold text-gray-800">{currentOrder.deliveryDate}</p>
              <p className="text-[11px] text-emerald-700 font-bold">
                {currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE
                  ? 'Paid Online (UPI)'
                  : 'Cash on Delivery'}
              </p>
            </div>
          </div>

          {/* Ordered Grocery Items */}
          <div>
            <div className="text-xs font-bold text-gray-700 mb-2 flex items-center justify-between">
              <span>Items in Order ({currentOrder.items.length})</span>
              <span className="text-[11px] text-gray-500 font-normal">Pack sizes & quantities</span>
            </div>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden text-xs">
              {currentOrder.items.map((item) => (
                <div key={item.id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                  <div>
                    <div className="font-bold text-gray-900">{item.productName}</div>
                    <div className="text-[11px] text-gray-500">
                      {item.packSize} {item.unit} • Qty: {item.quantity} × ₹{item.unitPrice}
                    </div>
                  </div>
                  <div className="font-black text-gray-900">₹{item.price}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-1.5 text-xs">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal:</span>
              <span>₹{currentOrder.subtotal}</span>
            </div>
            {currentOrder.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 font-bold">
                <span>Advance Online Discount (Saved):</span>
                <span>-₹{currentOrder.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Delivery Fee:</span>
              <span>{currentOrder.deliveryFee === 0 ? 'FREE' : `₹${currentOrder.deliveryFee}`}</span>
            </div>
            {currentOrder.codCharge > 0 && (
              <div className="flex justify-between text-amber-800">
                <span>COD Base Charge:</span>
                <span>+₹{currentOrder.codCharge}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-black text-[#0F2C59] border-t border-gray-200 pt-1.5">
              <span>Total Amount:</span>
              <span>₹{currentOrder.finalAmount}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-100 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0F2C59] text-white text-xs font-bold rounded-xl"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
