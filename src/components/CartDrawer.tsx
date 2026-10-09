import React, { useState, useMemo } from 'react';
import {
  X,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  ShieldCheck,
  Truck,
  Sparkles,
  Package,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Check,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PaymentMethod, PaymentStatus, Order } from '../types';
import { getActiveUnitPrice } from '../lib/engine/checkout-calculator';
import { formatVariantPack } from '../utils/variantFormatter';
import { ImageLightboxModal } from './ImageLightboxModal';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onProceedToCheckout: () => void;
  onOrderUpdated?: (order: Order) => void;
  onRedirectToPayment?: (details: {
    order: Order;
    remainingAmount: number;
    previousPaid: number;
    walletAmountUsed: number;
  }) => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  onProceedToCheckout,
  onOrderUpdated,
  onRedirectToPayment,
}) => {
  const {
    cart,
    updateCartQty,
    removeFromCart,
    clearCart,
    checkoutBreakdown,
    settings,
    editingOrder,
    cancelEditingOrder,
    saveEditedOrder,
    orders,
    currentUser,
    repeatLastOrder,
    repeatOrderNotice,
    setRepeatOrderNotice,
  } = useApp();
  const [zoomImage, setZoomImage] = useState<{ url: string; name: string; brand?: string } | null>(null);
  const [isSavingOrder, setIsSavingOrder] = useState<boolean>(false);

  // Customer past orders
  const customerOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        (currentUser.id && o.userId === currentUser.id) ||
        (currentUser.phone && o.customerPhone === currentUser.phone)
    );
  }, [orders, currentUser.id, currentUser.phone]);

  const lastOrder = useMemo(() => {
    if (customerOrders.length === 0) return null;
    return [...customerOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }, [customerOrders]);

  // Dedicated calculations for editing an existing order:
  // Recalculates new order total and applies eligible Advance Online Discount BEFORE subtracting amount already paid.
  const editSubtotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      const unitPrice = getActiveUnitPrice(
        item.variant.baseSellingPrice,
        item.quantity,
        item.variant.tieredPrices || []
      );
      return acc + unitPrice * item.quantity;
    }, 0);
  }, [cart]);

  const editEligibleSubtotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      if (item.product.isDiscountExcluded === true || (item.product.isDiscountExcluded as any) === 'true') {
        return acc;
      }
      const unitPrice = getActiveUnitPrice(
        item.variant.baseSellingPrice,
        item.quantity,
        item.variant.tieredPrices || []
      );
      return acc + unitPrice * item.quantity;
    }, 0);
  }, [cart]);

  const isEditingAdvance = editingOrder?.paymentMethod === PaymentMethod.ADVANCE_ONLINE;
  const editDiscountAmount = isEditingAdvance
    ? Math.round((editEligibleSubtotal * Math.max(0, Number(settings.advancePaymentDiscountPct) || 0)) / 100)
    : 0;

  const editDeliveryFee = editSubtotal >= settings.freeShippingMinAmount ? 0 : settings.baseDeliveryFee;
  const isEditingCod = editingOrder?.paymentMethod === PaymentMethod.COD;
  const editCodCharge = isEditingCod
    ? (editingOrder?.codCharge !== undefined && editingOrder.codCharge > 0
        ? editingOrder.codCharge
        : (currentUser.codOrderCount < 3 ? 0 : settings.codBaseCharge))
    : 0;

  // Example: ₹505 subtotal − ₹15 advance online discount = ₹490
  const editOrderTotal = Math.max(0, editSubtotal + editDeliveryFee + editCodCharge - editDiscountAmount);
  const editWalletUsed = Math.min(editOrderTotal, Math.max(0, editingOrder?.walletAmountUsed || 0));
  const editTotalAfterWallet = Math.max(0, editOrderTotal - editWalletUsed);

  const editWasPreviouslyPaid =
    editingOrder?.paymentStatus === PaymentStatus.RECEIVED ||
    (editingOrder?.paymentStatus as any) === 'PAID' ||
    (editingOrder as any)?.is_paid === true;

  const editPreviousOnlinePaid = editWasPreviouslyPaid
    ? Math.max(
        0,
        (editingOrder?.totalPayable !== undefined ? editingOrder.totalPayable : editingOrder?.finalAmount || 0) -
          (editingOrder?.walletAmountUsed || 0)
      )
    : 0;

  // Example: ₹490 − ₹204 already paid = ₹286 Balance to Pay Now
  const editRemainingPayable = isEditingCod
    ? 0
    : Math.max(0, editTotalAfterWallet - editPreviousOnlinePaid);

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
              {editingOrder ? `Edit Order #${editingOrder.orderNumber}` : `Shopping Cart (${cart.length})`}
            </h2>
            {editingOrder && (
              <span className="bg-amber-400/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-400/30">
                Editing Mode
              </span>
            )}
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

        {/* Editing Order Announcement Bar */}
        {editingOrder && (
          <div className="bg-amber-50 p-3 border-b border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-950">
            <div className="flex items-center gap-1.5 font-medium">
              <Sparkles size={14} className="text-[#FF6B00] shrink-0" />
              <span>
                Editing <strong>#{editingOrder.orderNumber}</strong>. Adjust quantities or add/remove items.
              </span>
            </div>
            <button
              onClick={cancelEditingOrder}
              className="text-[11px] font-bold text-gray-600 hover:text-gray-900 underline shrink-0 cursor-pointer"
            >
              Cancel Edit
            </button>
          </div>
        )}

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

        {/* Repeat Order Notification Banner */}
        {repeatOrderNotice && (
          <div
            id="cart-repeat-order-notice"
            className={`m-3 p-3 rounded-xl border text-xs flex items-start justify-between gap-2 shadow-2xs ${
              repeatOrderNotice.type === 'warning'
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : repeatOrderNotice.type === 'error'
                ? 'bg-red-50 border-red-300 text-red-950'
                : 'bg-emerald-50 border-emerald-300 text-emerald-950'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 text-white ${
                  repeatOrderNotice.type === 'warning'
                    ? 'bg-amber-500'
                    : repeatOrderNotice.type === 'error'
                    ? 'bg-red-500'
                    : 'bg-emerald-600'
                }`}
              >
                {repeatOrderNotice.type === 'warning' ? (
                  <AlertTriangle size={13} />
                ) : repeatOrderNotice.type === 'error' ? (
                  <AlertCircle size={13} />
                ) : (
                  <CheckCircle2 size={13} />
                )}
              </div>
              <div className="space-y-0.5 min-w-0">
                <div className="font-extrabold text-xs">
                  {repeatOrderNotice.type === 'warning'
                    ? 'Out-of-Stock Items Skipped'
                    : repeatOrderNotice.type === 'error'
                    ? 'Notice'
                    : 'Last Order Reloaded'}
                </div>
                <p className="text-[11px] leading-relaxed">{repeatOrderNotice.message}</p>
                {repeatOrderNotice.skippedItems && repeatOrderNotice.skippedItems.length > 0 && (
                  <div className="mt-1.5 p-2 bg-white/90 rounded-lg border border-amber-200">
                    <span className="font-bold text-[10px] text-amber-900 block mb-0.5">
                      Skipped (Out of Stock):
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-[10px] text-amber-800">
                      {repeatOrderNotice.skippedItems.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRepeatOrderNotice(null)}
              className="text-gray-400 hover:text-gray-700 p-1 shrink-0 cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-gray-100">
          {cart.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 text-gray-400">
                🛒
              </div>
              <h3 className="font-bold text-gray-700 text-sm">Your Cart is Empty</h3>
              <p className="text-xs text-gray-500 mt-1">
                Explore our wholesale groceries and necessities to add items.
              </p>
              <div className="mt-4 flex flex-col gap-2 items-center">
                <button
                  onClick={onClose}
                  className="w-full max-w-xs bg-[#0F2C59] hover:bg-[#153e7d] text-white text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer"
                >
                  Browse Products
                </button>
                {lastOrder && (
                  <button
                    type="button"
                    id="btn-repeat-last-order-cart-empty"
                    onClick={() => repeatLastOrder()}
                    className="w-full max-w-xs bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-105 text-white text-xs font-extrabold px-4 py-2.5 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <RotateCcw size={13} />
                    <span>Repeat Last Order (#{lastOrder.orderNumber})</span>
                  </button>
                )}
              </div>
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
                  {item.product.imageUrl && item.product.imageUrl.trim() ? (
                    <button
                      type="button"
                      onClick={() =>
                        setZoomImage({
                          url: item.product.imageUrl!,
                          name: item.product.name,
                          brand: item.product.brand,
                        })
                      }
                      className="w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0 cursor-pointer group/thumb relative focus:outline-hidden focus:ring-1 focus:ring-[#0F2C59]"
                      title={`Preview full image for ${item.product.name}`}
                      aria-label={`View larger photo of ${item.product.name}`}
                    >
                      <img
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform"
                      />
                    </button>
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-400">
                      <Package size={22} className="stroke-[1.5]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-gray-900 truncate">
                      {item.product.name}
                    </h4>
                    <p className="text-[11px] text-gray-500">
                      {formatVariantPack(item.variant)}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-xs font-black text-[#0F2C59]">
                        ₹{activePrice}
                      </span>
                      {hasTierDiscount && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded">
                          Bulk Tier Applied
                        </span>
                      )}
                      {(item.product.isDiscountExcluded === true || (item.product.isDiscountExcluded as any) === 'true') && (
                        <span className="text-[9px] bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.2 rounded">
                          Price Regulated (No UPI Discount)
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
            {checkoutBreakdown.advanceDiscountAmount > 0 ? (
              <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-emerald-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={14} className="text-emerald-600 shrink-0" />
                  <span>
                    Save extra <strong className="text-emerald-700 font-black">₹{checkoutBreakdown.advanceDiscountAmount}</strong> with Advance Online UPI (on eligible items)!
                  </span>
                </div>
                <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
              </div>
            ) : checkoutBreakdown.excludedSubtotal > 0 ? (
              <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl text-amber-900 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <AlertCircle size={14} className="text-amber-600 shrink-0" />
                  <span className="text-[11px]">
                    Cart contains <strong>Price Regulated items</strong> (excluded from online advance discount).
                  </span>
                </div>
              </div>
            ) : null}

            {/* Breakdown Summary */}
            {editingOrder ? (
              <div className="space-y-1.5 text-xs text-gray-600 border-t border-gray-200 pt-2 bg-gray-50/70 p-3 rounded-xl">
                <div className="flex justify-between">
                  <span>Items Subtotal ({cart.length} items):</span>
                  <span className="font-bold text-gray-900">₹{editSubtotal}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery Fee:</span>
                  <span>
                    {editDeliveryFee === 0 ? (
                      <span className="text-emerald-600 font-bold">FREE</span>
                    ) : (
                      `₹${editDeliveryFee}`
                    )}
                  </span>
                </div>
                {isEditingCod && editCodCharge > 0 && (
                  <div className="flex justify-between">
                    <span>COD Fee:</span>
                    <span>₹{editCodCharge}</span>
                  </div>
                )}
                {editDiscountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Advance Online Discount ({settings.advancePaymentDiscountPct}%):</span>
                    <span>-₹{editDiscountAmount}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200">
                  <span>Recalculated Order Total:</span>
                  <span>₹{editOrderTotal}</span>
                </div>
                {editWalletUsed > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Wallet Applied:</span>
                    <span>-₹{editWalletUsed}</span>
                  </div>
                )}
                {editPreviousOnlinePaid > 0 && (
                  <div className="flex justify-between text-blue-700 font-bold">
                    <span>Already Paid Online:</span>
                    <span>-₹{editPreviousOnlinePaid}</span>
                  </div>
                )}
                <div className="flex justify-between text-emerald-800 font-black pt-1.5 border-t border-emerald-300">
                  <span>
                    {isEditingCod
                      ? 'Total Payable on Delivery (COD):'
                      : editRemainingPayable > 0
                      ? 'Remaining Balance to Pay Online:'
                      : 'Remaining Online Balance:'}
                  </span>
                  <span className="text-sm font-black text-emerald-800">
                    {isEditingCod
                      ? `₹${editTotalAfterWallet}`
                      : editRemainingPayable > 0
                      ? `₹${editRemainingPayable}`
                      : '₹0 (Paid)'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-xs text-gray-600 border-t border-gray-200 pt-2">
                <div className="flex justify-between">
                  <span>Items Subtotal:</span>
                  <span className="font-bold text-gray-900">₹{checkoutBreakdown.subtotal}</span>
                </div>
                {checkoutBreakdown.excludedSubtotal > 0 && checkoutBreakdown.eligibleSubtotal > 0 && (
                  <>
                    <div className="flex justify-between text-[11px] text-gray-500 pl-2">
                      <span>• Eligible for Discount:</span>
                      <span>₹{checkoutBreakdown.eligibleSubtotal}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-amber-800 pl-2 font-medium">
                      <span>• Price Regulated (No Discount):</span>
                      <span>₹{checkoutBreakdown.excludedSubtotal}</span>
                    </div>
                  </>
                )}
                {checkoutBreakdown.advanceDiscountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Advance UPI Discount ({settings.advancePaymentDiscountPct}% on eligible):</span>
                    <span>-₹{checkoutBreakdown.advanceDiscountAmount}</span>
                  </div>
                )}
                {checkoutBreakdown.advanceDiscountAmount === 0 && checkoutBreakdown.excludedSubtotal > 0 && (
                  <div className="flex justify-between text-gray-500 text-[11px]">
                    <span>Advance UPI Discount:</span>
                    <span>₹0 (Price Regulated items)</span>
                  </div>
                )}
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
                {checkoutBreakdown.isWalletApplied && checkoutBreakdown.advanceWalletUsed && checkoutBreakdown.advanceWalletUsed > 0 ? (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Wallet Applied (Advance):</span>
                    <span>-₹{checkoutBreakdown.advanceWalletUsed}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-emerald-700 font-bold pt-1 border-t border-gray-200">
                  <span>Advance UPI Payable:</span>
                  <span className="text-sm font-black text-emerald-800">
                    ₹{checkoutBreakdown.advanceRemainingPayable ?? checkoutBreakdown.advanceFinalTotal}
                  </span>
                </div>
                <div className="flex justify-between text-gray-500 text-[11px]">
                  <span>COD Total (after door delivery):</span>
                  <span>₹{checkoutBreakdown.codRemainingPayable ?? checkoutBreakdown.codFinalTotal}</span>
                </div>
              </div>
            )}

            {/* Action Button: Update Order or Proceed to Checkout */}
            {editingOrder ? (
              <button
                id="save-edited-order-btn"
                disabled={cart.length === 0 || isSavingOrder}
                onClick={async () => {
                  setIsSavingOrder(true);
                  const result = await saveEditedOrder();
                  setIsSavingOrder(false);
                  if (result.success && result.updatedOrder) {
                    onClose();
                    if (result.requiresPayment && (result.remainingAmountToPay || 0) > 0) {
                      if (onRedirectToPayment) {
                        onRedirectToPayment({
                          order: result.updatedOrder,
                          remainingAmount: result.remainingAmountToPay || 0,
                          previousPaid: result.previousOnlinePaid || 0,
                          walletAmountUsed: result.walletAmountUsed || 0,
                        });
                      }
                    } else if (onOrderUpdated) {
                      onOrderUpdated(result.updatedOrder);
                    }
                  }
                }}
                className="w-full bg-[#0F2C59] hover:bg-[#153e7d] text-white p-3.5 rounded-xl font-extrabold text-sm flex items-center justify-between shadow-lg transition hover:scale-[1.01] disabled:opacity-50 cursor-pointer"
              >
                <div>
                  <div className="text-[10px] text-[#D4AF37] font-medium leading-none">
                    {editRemainingPayable > 0 && !isEditingCod
                      ? 'SAVE & PAY BALANCE'
                      : 'SAVE CHANGES TO ORDER'}
                  </div>
                  <div className="text-base font-black leading-tight text-white">
                    {isSavingOrder
                      ? 'Updating Order...'
                      : editRemainingPayable > 0 && !isEditingCod
                      ? `Pay Balance ₹${editRemainingPayable} • Order #${editingOrder.orderNumber}`
                      : `Update Order #${editingOrder.orderNumber}`}
                  </div>
                </div>
                <div className="bg-[#D4AF37] text-[#0F2C59] p-1.5 rounded-lg">
                  <Check size={18} />
                </div>
              </button>
            ) : (
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
            )}
          </div>
        )}
      </div>

      {/* Cart Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(zoomImage && zoomImage.url)}
        onClose={() => setZoomImage(null)}
        imageUrl={zoomImage?.url}
        title={zoomImage?.name}
        subtitle={zoomImage?.brand}
      />
    </div>
  );
};
