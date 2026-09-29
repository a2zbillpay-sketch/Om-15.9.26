import React, { useState, useEffect } from 'react';
import { X, Banknote, CheckCircle2, AlertCircle, Lock, Wallet } from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { useApp } from '../context/AppContext';

export interface CodCollectionModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    orderId: string,
    collectedAmount: number,
    markAsDelivered: boolean
  ) => { success: boolean; error?: string } | Promise<{ success: boolean; error?: string }>;
}

export const CodCollectionModal: React.FC<CodCollectionModalProps> = ({
  order,
  isOpen,
  onClose,
  onSave,
}) => {
  const { getCustomerOutstanding, users } = useApp();
  const [amountStr, setAmountStr] = useState<string>('');
  const [markDelivered, setMarkDelivered] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const billAmount = Math.max(0, Number(order?.finalAmount) || 0);
  const orderPayable = Math.max(0, Number(order?.totalPayable ?? billAmount));

  const targetCustomer = order?.userPhone || order?.userId || '';
  const customerUser = users.find(
    (u) =>
      (order?.userPhone &&
        (u.phone === order.userPhone ||
          u.phone?.replace(/\D/g, '').slice(-10) === order.userPhone?.replace(/\D/g, '').slice(-10))) ||
      (order?.userId && u.id === order.userId)
  );

  const rawOutstanding = getCustomerOutstanding(targetCustomer);
  const userWallet = customerUser ? customerUser.walletBalance : (rawOutstanding > 0 ? -rawOutstanding : 0);
  const negativeWalletDebt = userWallet < 0 ? Math.abs(userWallet) : (rawOutstanding > 0 ? rawOutstanding : 0);
  const maxCollectible = Math.round((orderPayable + negativeWalletDebt) * 100) / 100;

  useEffect(() => {
    if (order && isOpen) {
      // Keep "Actual Cash Collected / Deposited" blank until the shopkeeper/admin actually enters the amount collected from the customer.
      // Do NOT prefill the bill amount or any estimated amount.
      setAmountStr('');
      setMarkDelivered(order.status !== OrderStatus.DELIVERED);
      setError(null);
      setSaveSuccess(false);
      setIsSubmitting(false);
    }
  }, [order, isOpen]);

  if (!isOpen || !order) return null;

  const parsedAmount = parseFloat(amountStr.trim());
  const isValidNumber = !isNaN(parsedAmount) && isFinite(parsedAmount);
  const isNegative = isValidNumber && parsedAmount < 0;
  const exceedsPayable = isValidNumber && parsedAmount > maxCollectible;
  const isFullCollection = isValidNumber && parsedAmount === maxCollectible;
  const isOrderOnlyCollection = isValidNumber && parsedAmount === orderPayable && negativeWalletDebt > 0;
  const isPartial = isValidNumber && parsedAmount > 0 && parsedAmount < orderPayable;
  const isZero = isValidNumber && parsedAmount === 0;

  // Breakdown of allocation for this entered amount:
  // 1. Current order payable is covered first
  const allocatedToOrder = isValidNumber && !isNegative
    ? Math.min(parsedAmount, orderPayable)
    : 0;
  // 2. Excess cash beyond current order payable settles the customer's negative wallet balance
  const allocatedToWallet = isValidNumber && !isNegative
    ? Math.min(Math.max(0, parsedAmount - orderPayable), negativeWalletDebt)
    : 0;
  const remainingWalletDebt = Math.max(0, negativeWalletDebt - allocatedToWallet);

  const handleInputChange = (val: string) => {
    setError(null);
    setAmountStr(val);
  };

  const handleSetFull = () => {
    setError(null);
    setAmountStr(String(maxCollectible));
  };

  const handleSetOrderOnly = () => {
    setError(null);
    setAmountStr(String(orderPayable));
  };

  const handleSetZero = () => {
    setError(null);
    setAmountStr('0');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountStr.trim()) {
      setError('Please enter the collected amount.');
      return;
    }

    if (!isValidNumber) {
      setError('Please enter a valid monetary amount.');
      return;
    }

    if (isNegative) {
      setError('Collected amount cannot be negative.');
      return;
    }

    if (exceedsPayable) {
      setError(`Collected amount (₹${parsedAmount}) cannot exceed the collectible total (₹${maxCollectible}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onSave(order.id, parsedAmount, markDelivered);
      if (res.success) {
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
          onClose();
        }, 500);
      } else {
        setError(res.error || 'Failed to record COD collection.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to record COD collection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-[#0F2C59] p-5 text-white flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#FF6B00]">
              <Banknote size={22} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Record COD Collection</h3>
              <p className="text-xs text-gray-300 font-mono mt-0.5">
                #{order.orderNumber} • {order.userName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Order Details Banner */}
          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-xs text-[#0F2C59] space-y-1.5">
            <div className="flex items-center justify-between font-bold text-gray-700">
              <span className="flex items-center gap-1.5">
                <Lock size={13} className="text-gray-500" />
                <span>New Order Bill:</span>
              </span>
              <span className="font-extrabold text-gray-900">₹{orderPayable}</span>
            </div>

            {negativeWalletDebt > 0 && (
              <div className="flex items-center justify-between font-bold text-rose-800">
                <span className="flex items-center gap-1.5">
                  <Wallet size={13} className="text-rose-600" />
                  <span>Wallet Balance:</span>
                </span>
                <span className="font-extrabold text-rose-800">-₹{negativeWalletDebt}</span>
              </div>
            )}

            <div className="border-t border-amber-200/80 pt-1.5 flex items-center justify-between font-black text-sm text-[#0F2C59]">
              <span>Order Payable Amount:</span>
              <span className="text-base text-[#0F2C59]">₹{orderPayable}</span>
            </div>

            {order.codCollectedAmount !== undefined && order.codCollectedAmount > 0 && (
              <div className="flex items-center justify-between font-bold text-emerald-800 pt-1 border-t border-amber-200/60">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  <span>Previously Recorded:</span>
                </span>
                <span className="font-extrabold text-emerald-900">₹{order.codCollectedAmount}</span>
              </div>
            )}
          </div>

          {/* Actual Collected Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="cod-collected-input" className="text-xs font-bold text-gray-800">
                Actual Cash Collected / Deposited:
              </label>
              <div className="flex items-center gap-1.5">
                {negativeWalletDebt > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSetFull}
                      className="text-[10px] font-bold text-[#0F2C59] hover:text-[#FF6B00] bg-gray-100 hover:bg-orange-50 px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      Order + Settle (₹{maxCollectible})
                    </button>
                    <button
                      type="button"
                      onClick={handleSetOrderOnly}
                      className="text-[10px] font-bold text-gray-700 hover:text-[#0F2C59] bg-gray-100 hover:bg-blue-50 px-2 py-0.5 rounded transition cursor-pointer"
                    >
                      Order Only (₹{orderPayable})
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleSetOrderOnly}
                    className="text-[10px] font-bold text-[#0F2C59] hover:text-[#FF6B00] bg-gray-100 hover:bg-orange-50 px-2 py-0.5 rounded transition cursor-pointer"
                  >
                    Full Order (₹{orderPayable})
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSetZero}
                  className="text-[10px] font-bold text-gray-600 hover:text-red-600 bg-gray-100 hover:bg-red-50 px-2 py-0.5 rounded transition cursor-pointer"
                >
                  ₹0
                </button>
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-base">
                ₹
              </span>
              <input
                id="cod-collected-input"
                type="number"
                step="0.01"
                min="0"
                max={maxCollectible}
                value={amountStr}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="e.g. 150"
                className={`w-full pl-8 pr-4 py-2.5 bg-white border text-base font-bold text-gray-900 rounded-xl outline-none transition focus:ring-2 ${
                  exceedsPayable || isNegative
                    ? 'border-red-400 focus:ring-red-200'
                    : 'border-gray-300 focus:border-[#0F2C59] focus:ring-blue-100'
                }`}
                autoFocus
              />
            </div>
          </div>

          {/* Allocation summary card */}
          {isValidNumber && !isNegative && !exceedsPayable && (
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 text-xs space-y-1.5">
              <div className="flex justify-between text-gray-600">
                <span>Applied to Order Bill:</span>
                <span className="font-bold text-[#0F2C59]">
                  ₹{allocatedToOrder} / ₹{orderPayable}
                </span>
              </div>

              {negativeWalletDebt > 0 && (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>Applied to Settle Wallet Balance:</span>
                    <span className="font-bold text-rose-800">
                      ₹{allocatedToWallet} / ₹{negativeWalletDebt}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-gray-200 flex justify-between items-center font-bold">
                    <span>Wallet Balance after Settlement:</span>
                    <span className={remainingWalletDebt > 0 ? 'text-rose-700 font-extrabold' : 'text-emerald-700 font-black'}>
                      {remainingWalletDebt > 0 ? `-₹${remainingWalletDebt}` : '₹0 (Settled)'}
                    </span>
                  </div>
                </>
              )}

              {negativeWalletDebt === 0 && (
                <div className="pt-1.5 border-t border-gray-200 flex justify-between items-center font-bold">
                  <span>Remaining Unpaid:</span>
                  <span className={parsedAmount < orderPayable ? 'text-amber-700' : 'text-emerald-700 font-black'}>
                    {parsedAmount < orderPayable ? `₹${orderPayable - parsedAmount}` : '₹0 (All Cleared)'}
                  </span>
                </div>
              )}

              {/* Status Badge */}
              <div className="pt-1">
                {isFullCollection && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-lg">
                    <CheckCircle2 size={13} className="text-emerald-700 shrink-0" />
                    <span>
                      {negativeWalletDebt > 0
                        ? `Full Order & Wallet Settled (₹${maxCollectible})`
                        : `Full Order Cleared (₹${orderPayable})`}
                    </span>
                  </div>
                )}
                {isOrderOnlyCollection && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 bg-blue-100/80 px-2.5 py-1 rounded-lg">
                    <CheckCircle2 size={13} className="text-blue-700 shrink-0" />
                    <span>Order Cleared (₹{orderPayable}), Wallet Balance Remains -₹{negativeWalletDebt}</span>
                  </div>
                )}
                {isPartial && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900 bg-amber-100/80 px-2.5 py-1 rounded-lg">
                    <AlertCircle size={13} className="text-amber-700 shrink-0" />
                    <span>Partial COD: ₹{parsedAmount} collected (₹{orderPayable - parsedAmount} remaining on order)</span>
                  </div>
                )}
                {isZero && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-800 bg-red-100/80 px-2.5 py-1 rounded-lg">
                    <AlertCircle size={13} className="text-red-700 shrink-0" />
                    <span>₹0 Cash Collected (Order ₹{orderPayable} remains unpaid)</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Validation Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message Banner */}
          {saveSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
              <span className="font-bold">COD collection recorded successfully!</span>
            </div>
          )}

          {/* Mark as Delivered Checkbox */}
          <div className="pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer bg-gray-50 hover:bg-gray-100/80 p-3 rounded-xl border border-gray-200 transition">
              <input
                type="checkbox"
                checked={markDelivered}
                onChange={(e) => setMarkDelivered(e.target.checked)}
                className="w-4 h-4 rounded text-[#0F2C59] focus:ring-[#0F2C59] border-gray-300"
              />
              <div className="text-xs">
                <span className="font-bold text-gray-800">
                  Update order status to <span className="text-emerald-700 font-extrabold uppercase">Delivered</span>
                </span>
                <p className="text-[10px] text-gray-500">
                  Customer will see order delivered and payment status updated.
                </p>
              </div>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || saveSuccess}
              className="px-5 py-2 text-xs font-black text-white bg-[#0F2C59] hover:bg-[#0b2245] rounded-xl transition cursor-pointer shadow-md disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Cash Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
