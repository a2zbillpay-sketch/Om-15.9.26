import React, { useState, useEffect } from 'react';
import { X, Banknote, CheckCircle2, AlertCircle, Lock, ArrowRight, History } from 'lucide-react';
import { Order, OrderStatus } from '../types';

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
  const [amountStr, setAmountStr] = useState<string>('');
  const [markDelivered, setMarkDelivered] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const prevDebt = Math.max(0, Number(order?.previousOutstanding) || 0);
  const billAmount = Math.max(0, Number(order?.finalAmount) || 0);
  const totalPayable = order?.totalPayable ?? (billAmount + prevDebt);

  useEffect(() => {
    if (order && isOpen) {
      const initialAmount =
        order.codCollectedAmount !== undefined && order.codCollectedAmount > 0
          ? order.codCollectedAmount
          : totalPayable;
      setAmountStr(String(initialAmount));
      setMarkDelivered(order.status !== OrderStatus.DELIVERED);
      setError(null);
      setSaveSuccess(false);
      setIsSubmitting(false);
    }
  }, [order, isOpen, totalPayable]);

  if (!isOpen || !order) return null;

  const parsedAmount = parseFloat(amountStr.trim());
  const isValidNumber = !isNaN(parsedAmount) && isFinite(parsedAmount);
  const isNegative = isValidNumber && parsedAmount < 0;
  const exceedsPayable = isValidNumber && parsedAmount > totalPayable;
  const shortfall = isValidNumber && !isNegative && !exceedsPayable ? Math.max(0, totalPayable - parsedAmount) : 0;
  const isFullCollection = isValidNumber && parsedAmount === totalPayable;
  const isPartial = isValidNumber && parsedAmount > 0 && parsedAmount < totalPayable;
  const isZero = isValidNumber && parsedAmount === 0;

  // Breakdown of allocation for this entered amount
  const allocatedToPrevious = isValidNumber && !isNegative
    ? Math.min(parsedAmount, prevDebt)
    : 0;
  const allocatedToOrder = isValidNumber && !isNegative
    ? Math.min(Math.max(0, parsedAmount - prevDebt), billAmount)
    : 0;

  const handleInputChange = (val: string) => {
    setError(null);
    setAmountStr(val);
  };

  const handleSetFull = () => {
    setError(null);
    setAmountStr(String(totalPayable));
  };

  const handleSetOrderOnly = () => {
    setError(null);
    setAmountStr(String(billAmount));
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
      setError(`Collected amount (₹${parsedAmount}) cannot exceed the total payable amount (₹${totalPayable}).`);
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
          {/* Outstanding Balance Breakdown Banner */}
          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-xs text-[#0F2C59] space-y-1.5">
            <div className="flex items-center justify-between font-bold text-gray-700">
              <span className="flex items-center gap-1.5">
                <Lock size={13} className="text-gray-500" />
                <span>New Order Bill (Fixed):</span>
              </span>
              <span className="font-extrabold text-gray-900">₹{billAmount}</span>
            </div>

            {prevDebt > 0 && (
              <div className="flex items-center justify-between font-bold text-amber-900">
                <span className="flex items-center gap-1.5">
                  <History size={13} className="text-amber-700" />
                  <span>Previous Outstanding:</span>
                </span>
                <span className="font-extrabold text-amber-900">+₹{prevDebt}</span>
              </div>
            )}

            <div className="border-t border-amber-200/80 pt-1.5 flex items-center justify-between font-black text-sm text-[#0F2C59]">
              <span>Total Payable Amount:</span>
              <span className="text-base text-[#0F2C59]">₹{totalPayable}</span>
            </div>
          </div>

          {/* Actual Collected Amount Input */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="cod-collected-input" className="text-xs font-bold text-gray-800">
                Actual Cash Collected / Deposited:
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSetFull}
                  className="text-[10px] font-bold text-[#0F2C59] hover:text-[#FF6B00] bg-gray-100 hover:bg-orange-50 px-2 py-0.5 rounded transition cursor-pointer"
                >
                  Full Total (₹{totalPayable})
                </button>
                {prevDebt > 0 && (
                  <button
                    type="button"
                    onClick={handleSetOrderOnly}
                    className="text-[10px] font-bold text-gray-700 hover:text-[#0F2C59] bg-gray-100 hover:bg-blue-50 px-2 py-0.5 rounded transition cursor-pointer"
                  >
                    Order (₹{billAmount})
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
                max={totalPayable}
                value={amountStr}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="e.g. 1100"
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
              {prevDebt > 0 ? (
                <>
                  <div className="flex justify-between text-gray-600">
                    <span>Applied to Previous Outstanding:</span>
                    <span className="font-bold text-amber-900">
                      ₹{allocatedToPrevious} / ₹{prevDebt}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Applied to Current Order Bill:</span>
                    <span className="font-bold text-[#0F2C59]">
                      ₹{allocatedToOrder} / ₹{billAmount}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-gray-600">
                  <span>Applied to Order Bill:</span>
                  <span className="font-bold text-[#0F2C59]">₹{parsedAmount} / ₹{billAmount}</span>
                </div>
              )}

              <div className="pt-1.5 border-t border-gray-200 flex justify-between items-center font-bold">
                <span>Remaining Customer Outstanding:</span>
                <span className={shortfall > 0 ? 'text-amber-700' : 'text-emerald-700 font-black'}>
                  {shortfall > 0 ? `₹${shortfall}` : '₹0 (All Cleared)'}
                </span>
              </div>

              {/* Status Badge */}
              <div className="pt-1">
                {isFullCollection && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-lg">
                    <CheckCircle2 size={13} className="text-emerald-700 shrink-0" />
                    <span>Full Total Cleared (₹{totalPayable})</span>
                  </div>
                )}
                {isPartial && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900 bg-amber-100/80 px-2.5 py-1 rounded-lg">
                    <AlertCircle size={13} className="text-amber-700 shrink-0" />
                    <span>Partial COD: ₹{parsedAmount} collected (₹{shortfall} remaining debt)</span>
                  </div>
                )}
                {isZero && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-800 bg-red-100/80 px-2.5 py-1 rounded-lg">
                    <AlertCircle size={13} className="text-red-700 shrink-0" />
                    <span>₹0 Cash Collected (Entire ₹{totalPayable} remains unpaid)</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Validation Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {saveSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
              <span>Collection record permanently saved to database!</span>
            </div>
          )}

          {/* Status Delivery Checkbox */}
          {order.status !== OrderStatus.DELIVERED && (
            <label className="flex items-center gap-2.5 text-xs text-gray-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={markDelivered}
                onChange={(e) => setMarkDelivered(e.target.checked)}
                className="w-4 h-4 rounded text-[#0F2C59] border-gray-300 focus:ring-[#0F2C59] cursor-pointer"
              />
              <span className="font-medium">Mark order as Delivered upon saving</span>
            </label>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(error) || exceedsPayable || isNegative || !isValidNumber || isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0F2C59] hover:bg-[#163a6e] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
            >
              <span>{isSubmitting ? 'Saving...' : 'Save Collection'}</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
