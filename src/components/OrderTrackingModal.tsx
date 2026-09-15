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
  const { cancelOrder, currentUser } = useApp();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;

    const calculateTimeLeft = () => {
      const orderTime = new Date(order.createdAt).getTime();
      const windowMs = 15 * 60 * 1000;
      const elapsed = Date.now() - orderTime;
      const remaining = Math.max(0, Math.floor((windowMs - elapsed) / 1000));
      setSecondsRemaining(remaining);
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [order]);

  if (!isOpen || !order) return null;

  const isCancellable =
    order.status !== OrderStatus.CANCELLED &&
    order.status !== OrderStatus.DELIVERED &&
    secondsRemaining > 0;

  const minutesLeft = Math.floor(secondsRemaining / 60);
  const secondsLeft = secondsRemaining % 60;

  const handleCancel = () => {
    const success = cancelOrder(order.id);
    if (success) {
      setCancelMessage(
        order.paymentMethod === PaymentMethod.ADVANCE_ONLINE
          ? 'Order cancelled! ₹' + order.finalAmount + ' has been refunded directly to your Store Wallet.'
          : 'Order successfully cancelled.'
      );
    }
  };

  const steps = [
    { key: OrderStatus.ORDER_ACCEPTED, label: 'Order Accepted', icon: CheckCircle },
    { key: OrderStatus.PACKING_IN_PROGRESS, label: 'Packing', icon: Package },
    { key: OrderStatus.READY_FOR_DELIVERY, label: 'Ready', icon: PackageCheck },
    { key: OrderStatus.ON_THE_WAY, label: 'On The Way', icon: Truck },
    { key: OrderStatus.DELIVERED, label: 'Delivered', icon: CheckCircle },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === order.status);

  return (
    <div
      id="order-tracking-modal"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
    >
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border-t-4 border-[#0F2C59] max-h-[90vh] flex flex-col justify-between">
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-extrabold text-base text-[#D4AF37]">
                Order #{order.orderNumber}
              </h2>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${
                  order.status === OrderStatus.CANCELLED
                    ? 'bg-red-500 text-white'
                    : order.status === OrderStatus.DELIVERED
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[#FF6B00] text-white'
                }`}
              >
                {order.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-[11px] text-gray-300">
              Placed on {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(order.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* 15-Minute Cancellation Window Banner */}
          {order.status !== OrderStatus.CANCELLED && (
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

          {/* Stepper Status Bar */}
          {order.status !== OrderStatus.CANCELLED && (
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div className="text-xs font-bold text-gray-700 mb-3">Fulfillment Progress</div>
              <div className="relative flex justify-between items-center">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-gray-200 w-full z-0" />
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-emerald-600 z-0 transition-all duration-500"
                  style={{
                    width: `${
                      currentStepIndex >= 0
                        ? (currentStepIndex / (steps.length - 1)) * 100
                        : 0
                    }%`,
                  }}
                />

                {steps.map((step, idx) => {
                  const isDone = idx <= currentStepIndex;
                  const isCurrent = idx === currentStepIndex;
                  const Icon = step.icon;

                  return (
                    <div key={step.key} className="relative z-10 flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                          isDone
                            ? 'bg-emerald-600 text-white shadow'
                            : 'bg-white text-gray-400 border border-gray-300'
                        } ${isCurrent ? 'ring-4 ring-emerald-100 scale-110' : ''}`}
                      >
                        <Icon size={14} />
                      </div>
                      <span
                        className={`text-[9px] font-bold mt-1 text-center max-w-[60px] leading-tight ${
                          isDone ? 'text-gray-900' : 'text-gray-400'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Delivery & Recipient Details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
              <div className="text-gray-500 font-bold flex items-center gap-1 mb-1">
                <MapPin size={12} className="text-[#FF6B00]" />
                <span>Delivery Address</span>
              </div>
              <p className="font-semibold text-gray-800">{order.address.fullAddress}</p>
              <p className="text-[11px] text-gray-500">Pincode: {order.address.pincode}</p>
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
              <div className="text-gray-500 font-bold flex items-center gap-1 mb-1">
                <Calendar size={12} className="text-[#0F2C59]" />
                <span>Scheduled Date</span>
              </div>
              <p className="font-semibold text-gray-800">{order.deliveryDate}</p>
              <p className="text-[11px] text-emerald-700 font-bold">
                {order.paymentMethod === PaymentMethod.ADVANCE_ONLINE
                  ? 'Paid Online (UPI)'
                  : 'Cash on Delivery'}
              </p>
            </div>
          </div>

          {/* Ordered Grocery Items */}
          <div>
            <div className="text-xs font-bold text-gray-700 mb-2 flex items-center justify-between">
              <span>Items in Order ({order.items.length})</span>
              <span className="text-[11px] text-gray-500 font-normal">Pack sizes & quantities</span>
            </div>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden text-xs">
              {order.items.map((item) => (
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
              <span>₹{order.subtotal}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 font-bold">
                <span>Advance Online Discount (Saved):</span>
                <span>-₹{order.discountAmount}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Delivery Fee:</span>
              <span>{order.deliveryFee === 0 ? 'FREE' : `₹${order.deliveryFee}`}</span>
            </div>
            {order.codCharge > 0 && (
              <div className="flex justify-between text-amber-800">
                <span>COD Base Charge:</span>
                <span>+₹{order.codCharge}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-black text-[#0F2C59] border-t border-gray-200 pt-1.5">
              <span>Total Amount:</span>
              <span>₹{order.finalAmount}</span>
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
