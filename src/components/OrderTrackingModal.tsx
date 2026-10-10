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
  Edit3,
  ExternalLink,
  CreditCard,
} from 'lucide-react';
import { Order, OrderStatus, PaymentMethod, PaymentStatus } from '../types';
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
  onOpenCart?: () => void;
  onPayPendingBalance?: (order: Order) => void;
}

export const OrderTrackingModal: React.FC<OrderTrackingModalProps> = ({
  order,
  isOpen,
  onClose,
  onOpenCart,
  onPayPendingBalance,
}) => {
  const { orders, cancelOrder, startEditingOrder, repeatOrder, currentUser } = useApp();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);

  // Automatically sync with latest order state from AppContext
  const currentOrder = (order && orders.find((o) => o.id === order.id)) || order;

  useEffect(() => {
    if (!currentOrder) return;

    const calculateTimeLeft = () => {
      if (!currentOrder?.createdAt) return;
      const orderTime = new Date(currentOrder.createdAt).getTime();
      if (isNaN(orderTime)) return;
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

  const isAdvance =
    currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE ||
    currentOrder.paymentStatus === PaymentStatus.RECEIVED;

  const walletUsed = Math.max(0, currentOrder.walletAmountUsed || 0);

  const isFinalAmountNetOfWallet =
    isAdvance &&
    walletUsed > 0 &&
    currentOrder.subtotal !== undefined &&
    Math.abs(currentOrder.finalAmount - (currentOrder.subtotal - (currentOrder.discountAmount || 0) + (currentOrder.deliveryFee || 0) - walletUsed)) < 2;

  const previousOnlineAdvancePaid =
    currentOrder.previousOnlinePaid !== undefined && currentOrder.previousOnlinePaid > 0
      ? currentOrder.previousOnlinePaid
      : isAdvance && currentOrder.totalPayable !== undefined && currentOrder.totalPayable < currentOrder.finalAmount
      ? Math.max(0, currentOrder.finalAmount - (isFinalAmountNetOfWallet ? 0 : walletUsed) - currentOrder.totalPayable)
      : isAdvance && (currentOrder.paymentStatus === PaymentStatus.RECEIVED || (currentOrder.paymentStatus as any) === 'PAID')
      ? (isFinalAmountNetOfWallet ? currentOrder.finalAmount : Math.max(0, currentOrder.finalAmount - walletUsed))
      : 0;

  const isPaid =
    currentOrder.status !== OrderStatus.CANCELLED &&
    currentOrder.paymentStatus !== PaymentStatus.REFUNDED &&
    (currentOrder.paymentStatus === PaymentStatus.RECEIVED ||
      (currentOrder.paymentStatus as any) === 'PAID' ||
      (currentOrder as any).is_paid === true);

  const actualOnlinePayment = isAdvance
    ? isPaid
      ? isFinalAmountNetOfWallet
        ? currentOrder.finalAmount
        : Math.max(0, currentOrder.finalAmount - walletUsed)
      : previousOnlineAdvancePaid
    : 0;

  let amountCollected = 0;
  if (isPaid && currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE) {
    amountCollected = walletUsed + actualOnlinePayment;
  } else if (currentOrder.codCollectedAmount !== undefined && currentOrder.codCollectedAmount > 0) {
    amountCollected = currentOrder.codCollectedAmount;
  } else if (isPaid) {
    amountCollected = currentOrder.totalPayable !== undefined ? currentOrder.totalPayable : currentOrder.finalAmount;
  }

  const handleCancel = () => {
    const refundAmount = walletUsed + actualOnlinePayment;
    const success = cancelOrder(currentOrder.id);
    if (success) {
      let isRefunded = false;
      try {
        const savedOrders = localStorage.getItem('om_orders');
        if (savedOrders) {
          const parsed = JSON.parse(savedOrders);
          const found = parsed.find((o: any) => o.id === currentOrder.id || o.orderNumber === currentOrder.orderNumber);
          if (found && found.paymentStatus === PaymentStatus.REFUNDED) {
            isRefunded = true;
          }
        }
      } catch {}

      setCancelMessage(
        refundAmount > 0 && isRefunded
          ? walletUsed > 0 && actualOnlinePayment > 0
            ? `Order cancelled! Full refund of ₹${refundAmount} (₹${walletUsed} wallet used + ₹${actualOnlinePayment} online advance) has been refunded directly to your Store Wallet.`
            : walletUsed > 0
            ? `Order cancelled! Full refund of ₹${refundAmount} (₹${walletUsed} wallet used) has been refunded directly to your Store Wallet.`
            : `Order cancelled! Full refund of ₹${refundAmount} online payment has been refunded directly to your Store Wallet.`
          : 'Order successfully cancelled.'
      );
    }
  };

  const handleEditOrder = () => {
    if (!currentOrder) return;
    startEditingOrder(currentOrder);
    onClose();
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
                      ? '15-Minute Instant Edit Window Active'
                      : 'Edit Window Closed'}
                  </div>
                  <div className="text-[11px] mt-0.5">
                    {isCancellable ? (
                      <span>
                        You can edit your order items within{' '}
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
                  onClick={handleEditOrder}
                  className="bg-[#0F2C59] hover:bg-[#153e7d] text-white font-bold text-xs px-3 py-1.5 rounded-lg shrink-0 shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 size={13} className="text-[#D4AF37]" />
                  <span>Edit Order</span>
                </button>
              )}
            </div>
          )}

          {cancelMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl font-semibold">
              {cancelMessage}
            </div>
          )}

          {currentOrder.status === OrderStatus.CANCELLED && !cancelMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl font-semibold">
              {(() => {
                const wUsed = Math.max(0, currentOrder.walletAmountUsed || 0);
                const isAdv =
                  currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE ||
                  currentOrder.paymentStatus === PaymentStatus.RECEIVED ||
                  currentOrder.paymentStatus === PaymentStatus.REFUNDED;
                const isFinalNet =
                  wUsed > 0 &&
                  currentOrder.subtotal !== undefined &&
                  Math.abs(currentOrder.finalAmount - (currentOrder.subtotal - (currentOrder.discountAmount || 0) + (currentOrder.deliveryFee || 0) - wUsed)) < 2;
                const oPaid = isAdv
                  ? currentOrder.previousOnlinePaid !== undefined && currentOrder.previousOnlinePaid > 0
                    ? currentOrder.previousOnlinePaid
                    : isFinalNet
                    ? currentOrder.finalAmount
                    : Math.max(0, currentOrder.finalAmount - wUsed)
                  : 0;
                const rTot = wUsed + oPaid;
                const isRefunded = currentOrder.paymentStatus === PaymentStatus.REFUNDED;
                if (rTot > 0 && isRefunded) {
                  return wUsed > 0 && oPaid > 0
                    ? `Order Cancelled. Full refund of ₹${rTot} (₹${wUsed} wallet used + ₹${oPaid} online advance) has been refunded to your Store Wallet.`
                    : wUsed > 0
                    ? `Order Cancelled. Full refund of ₹${rTot} (₹${wUsed} wallet used) has been refunded to your Store Wallet.`
                    : `Order Cancelled. Full refund of ₹${rTot} online payment has been refunded to your Store Wallet.`;
                }
                return 'Order has been cancelled.';
              })()}
            </div>
          )}

          {/* Delivery & Recipient Details */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200">
              <div className="text-gray-500 font-bold flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <MapPin size={12} className="text-[#FF6B00]" />
                  <span>Delivery Address</span>
                </div>
                {(currentOrder.googleLocation || currentOrder.address?.googleLocation) && (
                  <a
                    href={
                      (currentOrder.googleLocation || currentOrder.address?.googleLocation)?.mapsUrl ||
                      `https://www.google.com/maps?q=${
                        (currentOrder.googleLocation || currentOrder.address?.googleLocation)?.latitude
                      },${(currentOrder.googleLocation || currentOrder.address?.googleLocation)?.longitude}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-700 hover:text-blue-900 underline font-bold flex items-center gap-0.5"
                    title="Open in Google Maps"
                  >
                    <span>Google Maps</span>
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
              {currentOrder.userName && (
                <div className="font-bold text-gray-900 text-xs mb-0.5">{currentOrder.userName}</div>
              )}
              {currentOrder.userPhone && (
                <div className="text-[10px] text-gray-500 font-mono mb-1">+91 {currentOrder.userPhone}</div>
              )}
              <p className="font-semibold text-gray-800">
                {typeof currentOrder.address === 'string'
                  ? currentOrder.address
                  : currentOrder.address?.fullAddress || 'Address not specified'}
              </p>
              {typeof currentOrder.address === 'object' && currentOrder.address?.pincode && (
                <p className="text-[11px] text-gray-500">Pincode: {currentOrder.address.pincode}</p>
              )}
              {(currentOrder.googleLocation || currentOrder.address?.googleLocation) && (
                <div className="mt-1 text-[10px] text-emerald-800 font-bold flex items-center gap-1">
                  <span>📍 GPS Pin Attached</span>
                </div>
              )}
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
              <span>Items in Order ({(currentOrder.items || []).length})</span>
              <span className="text-[11px] text-gray-500 font-normal">Pack sizes & quantities</span>
            </div>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden text-xs">
              {(currentOrder.items || []).map((item) => (
                <div key={item.id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-gray-900">
                      <span>{item.productName}</span>
                      {item.isDiscountExcluded && (
                        <span className="text-[9px] bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.2 rounded font-semibold">
                          Price Regulated
                        </span>
                      )}
                    </div>
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
            {currentOrder.discountAmount > 0 ? (
              <div className="flex justify-between text-emerald-700 font-bold">
                <span>Advance Online Discount (Saved):</span>
                <span>-₹{currentOrder.discountAmount}</span>
              </div>
            ) : currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE ? (
              <div className="flex justify-between text-gray-500 text-[11px]">
                <span>Advance Online Discount:</span>
                <span>₹0 (Price Regulated items)</span>
              </div>
            ) : null}
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

            <div className="flex justify-between text-xs text-gray-700 font-semibold border-t border-gray-200 pt-1.5">
              <span>{previousOnlineAdvancePaid > 0 ? 'Total Bill Amount:' : (currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE ? 'Final Bill:' : 'Order Amount:')}</span>
              <span>₹{currentOrder.finalAmount}</span>
            </div>

            {isPaid ? (
              <>
                {walletUsed > 0 && (
                  <div className="flex justify-between text-xs text-emerald-700 font-bold">
                    <span>Wallet Applied:</span>
                    <span>₹{walletUsed}</span>
                  </div>
                )}

                <div className="flex justify-between text-xs text-emerald-700 font-bold">
                  <span>Actual Online Payment (UPI/etc.):</span>
                  <span>₹{actualOnlinePayment}</span>
                </div>

                <div className="flex justify-between text-xs font-black text-gray-900 border-t border-gray-200 pt-1.5">
                  <span>Amount Collected:</span>
                  <span>₹{amountCollected}</span>
                </div>

                <div className="flex justify-between items-center text-xs font-bold pt-1.5 border-t border-gray-200">
                  <span className="text-gray-700">Payment Status:</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                    PAID
                  </span>
                </div>
              </>
            ) : (
              <>
                {walletUsed > 0 && (
                  <div className="flex justify-between text-xs text-emerald-700 font-bold">
                    <span>Wallet Applied:</span>
                    <span>-₹{walletUsed}</span>
                  </div>
                )}

                {previousOnlineAdvancePaid > 0 && (
                  <div className="flex justify-between text-xs text-blue-700 font-bold">
                    <span>Previous Online Advance Paid:</span>
                    <span>-₹{previousOnlineAdvancePaid}</span>
                  </div>
                )}

                <div className="flex justify-between text-sm font-black text-[#0F2C59] border-t border-gray-200 pt-1.5">
                  <span>{previousOnlineAdvancePaid > 0 ? 'Balance to Pay Now:' : 'Total Payable:'}</span>
                  <span>₹{currentOrder.status === OrderStatus.CANCELLED ? 0 : (currentOrder.totalPayable ?? currentOrder.finalAmount)}</span>
                </div>

                {currentOrder.codCollectedAmount !== undefined && currentOrder.codCollectedAmount > 0 && (
                  <div className="flex justify-between text-xs text-emerald-700 font-bold pt-0.5">
                    <span>Amount Collected:</span>
                    <span>₹{currentOrder.codCollectedAmount}</span>
                  </div>
                )}

                <div className="flex justify-between items-center text-xs font-bold pt-1.5 border-t border-gray-200">
                  <span className="text-gray-700">Payment Status:</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300">
                    {currentOrder.paymentStatus === PaymentStatus.REFUNDED
                      ? 'REFUNDED'
                      : currentOrder.status === OrderStatus.CANCELLED
                      ? 'CANCELLED'
                      : 'PENDING / UNPAID'}
                  </span>
                </div>

                {!isPaid &&
                  currentOrder.status !== OrderStatus.CANCELLED &&
                  currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE &&
                  onPayPendingBalance && (
                    <button
                      type="button"
                      id="pay-pending-balance-btn"
                      onClick={() => {
                        onClose();
                        onPayPendingBalance(currentOrder);
                      }}
                      className="w-full mt-2.5 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CreditCard size={15} />
                      <span>
                        Pay Balance ₹{currentOrder.totalPayable ?? currentOrder.finalAmount} Online Now
                      </span>
                    </button>
                  )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-100 border-t border-gray-200 flex items-center justify-between gap-2">
          {currentOrder && (
            <button
              type="button"
              id="btn-repeat-order-tracking"
              onClick={() => {
                repeatOrder(currentOrder);
                onClose();
                if (onOpenCart) onOpenCart();
              }}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-105 text-white text-xs font-extrabold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer active:scale-95"
              title="Reload items from this order into your cart at current prices"
            >
              <RotateCcw size={13} />
              <span>Repeat Order</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-white text-xs font-bold rounded-xl cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
