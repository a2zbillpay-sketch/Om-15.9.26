import React, { useState, useEffect } from 'react';
import { X, Banknote, CheckCircle2, AlertCircle, Lock, ArrowRight } from 'lucide-react';
import { Order, OrderStatus } from '../types';

export interface CodCollectionModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    orderId: string,
    collectedAmount: number,
    markAsDelivered: boolean
  ) => { success: boolean; error?: string };
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

  useEffect(() => {
    if (order && isOpen) {
      const initialAmount =
        order.codCollectedAmount !== undefined
          ? order.codCollectedAmount
          : order.finalAmount;
      setAmountStr(String(initialAmount));
      setMarkDelivered(order.status !== OrderStatus.DELIVERED);
      setError(null);
      setSaveSuccess(false);
    }
  }, [order, isOpen]);

  if (!isOpen || !order) return null;

  const parsedAmount = parseFloat(amountStr.trim());
  const isValidNumber = !isNaN(parsedAmount) && isFinite(parsedAmount);
  const isNegative = isValidNumber && parsedAmount < 0;
  const exceedsBill = isValidNumber && parsedAmount > order.finalAmount;
  const shortfall = isValidNumber && !isNegative && !exceedsBill ? Math.max(0, order.finalAmount - parsedAmount) : 0;
  const isFullCollection = isValidNumber && parsedAmount === order.finalAmount;
  const isPartial = isValidNumber && parsedAmount > 0 && parsedAmount < order.finalAmount;
  const isZero = isValidNumber && parsedAmount === 0;

  const handleInputChange = (val: string) => {
    setError(null);
    setAmountStr(val);
  };

  const handleSetFull = () => {
    setError(null);
    setAmountStr(String(order.finalAmount));
  };

  const handleSetZero = () => {
    setError(null);
    setAmountStr('0');
  };

  const handleSubmit = (e: React.FormEvent) => {
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

    if (exceedsBill) {
      setError(`Collected amount (₹${parsedAmount}) cannot exceed the bill amount (₹${order.finalAmount}).`);
      return;
    }

    const res = onSave(order.id, parsedAmount, markDelivered);
    if (res.success) {
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 400);
    } else {
      setError(res.error || 'Failed to record COD collection.');
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
          {/* Bill Amount vs Collection Separation Banner */}
          <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-xs text-[#0F2C59] flex items-start gap-2.5">
            <Lock size={15} className="text-[#0F2C59] shrink-0 mt-0.5" />
            <div>
              <div className="font-bold flex items-center justify-between">
                <span>Original Bill Amount (Fixed):</span>
                <span className="text-sm font-black text-[#0F2C59]">₹{order.finalAmount}</span>
              </div>
              <p className="text-[11px] text-gray-600 mt-0.5">
                The original bill is preserved and will never be overwritten. Record the actual cash collected below.
              </p>
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
                  Full (₹{order.finalAmount})
                </button>
                <button
                  type="button"
                  onClick={handleSetZero}
                  className="text-[10px] font-bold text-gray-600 hover:text-red-600 bg-gray-100 hover:bg-red-50 px-2 py-0.5 rounded transition cursor-pointer"
                >
                  ₹0 (Uncollected)
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
                max={order.finalAmount}
                value={amountStr}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="e.g. 700"
                className={`w-full pl-8 pr-4 py-2.5 bg-white border text-base font-bold text-gray-900 rounded-xl outline-none transition focus:ring-2 ${
                  exceedsBill || isNegative
                    ? 'border-red-400 focus:ring-red-200'
                    : 'border-gray-300 focus:border-[#0F2C59] focus:ring-blue-100'
                }`}
                autoFocus
              />
            </div>
          </div>

          {/* Breakdown summary card */}
          {isValidNumber && !isNegative && !exceedsBill && (
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 text-xs space-y-1.5">
              <div className="flex justify-between text-gray-600">
                <span>Total Invoice Bill:</span>
                <span className="font-semibold text-gray-900">₹{order.finalAmount}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Amount Deposited / Collected:</span>
                <span className="font-bold text-[#0F2C59]">₹{parsedAmount}</span>
              </div>
              <div className="pt-1.5 border-t border-gray-200 flex justify-between items-center font-bold">
                <span>Shortfall / Balance:</span>
                <span className={shortfall > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                  ₹{shortfall}
                </span>
              </div>

              {/* Status Badge */}
              <div className="pt-1">
                {isFullCollection && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-100/80 px-2.5 py-1 rounded-lg">
                    <CheckCircle2 size={13} className="text-emerald-700 shrink-0" />
                    <span>Full Payment Collected (₹{order.finalAmount})</span>
                  </div>
                )}
                {isPartial && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900 bg-amber-100/80 px-2.5 py-1 rounded-lg">
                    <AlertCircle size={13} className="text-amber-700 shrink-0" />
                    <span>Partial / Short COD: ₹{parsedAmount} collected (₹{shortfall} short)</span>
                  </div>
                )}
                {isZero && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-800 bg-red-100/80 px-2.5 py-1 rounded-lg">
                    <AlertCircle size={13} className="text-red-700 shrink-0" />
                    <span>₹0 Cash Collected (Entire bill ₹{order.finalAmount} pending)</span>
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
              <span>Collection record saved successfully!</span>
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
              disabled={Boolean(error) || exceedsBill || isNegative || !isValidNumber}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0F2C59] hover:bg-[#163a6e] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
            >
              <span>Save Collection</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
