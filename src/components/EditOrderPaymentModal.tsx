import React, { useState } from 'react';
import { X, ShieldCheck, CheckCircle2, AlertTriangle, ArrowRight, Wallet } from 'lucide-react';
import { Order, PaymentStatus } from '../types';
import { useApp } from '../context/AppContext';

export interface EditOrderPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  remainingAmountToPay: number;
  previousOnlinePaid: number;
  walletAmountUsed: number;
  onPaymentSuccess: (updatedOrder: Order) => void;
}

export const EditOrderPaymentModal: React.FC<EditOrderPaymentModalProps> = ({
  isOpen,
  onClose,
  order,
  remainingAmountToPay,
  previousOnlinePaid,
  walletAmountUsed,
  onPaymentSuccess,
}) => {
  const { confirmEditedOrderPayment } = useApp();
  const [selectedUpiApp, setSelectedUpiApp] = useState<'PAYTM' | 'PHONEPE' | 'GPAY' | 'QR'>('QR');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !order) return null;

  const handlePayNow = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const res = await confirmEditedOrderPayment(order.id, selectedUpiApp);
      if (res.success && res.updatedOrder) {
        setIsProcessing(false);
        onPaymentSuccess(res.updatedOrder);
      } else {
        setIsProcessing(false);
        setErrorMessage(res.error || 'Payment failed. Please try again.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setErrorMessage(err?.message || 'Error processing balance payment.');
    }
  };

  return (
    <div
      id="edit-order-payment-modal"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border-t-4 border-emerald-600 max-h-[92vh] flex flex-col justify-between">
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider bg-amber-400 text-[#0F2C59] px-2 py-0.5 rounded">
                Action Required
              </span>
              <h2 className="font-extrabold text-base text-[#D4AF37]">
                Complete Balance Payment
              </h2>
            </div>
            <p className="text-xs text-gray-300 mt-0.5">
              Order #{order.orderNumber} • Edited Order Balance
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Important Notice */}
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-900 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-950">
              <AlertTriangle size={15} className="text-amber-700 shrink-0" />
              <span>Payment Pending</span>
            </div>
            <p className="leading-relaxed">
              Your edited order is saved. To mark this order as <strong>PAID</strong>, please complete the newly required online balance payment below.
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs font-bold rounded-xl flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Balance Breakdown Card */}
          <div className="bg-emerald-50/80 border-2 border-emerald-400 rounded-xl p-4 text-center">
            <div className="text-xs font-bold text-emerald-900 uppercase tracking-wide">
              Remaining Amount to Pay Online
            </div>
            <div className="text-3xl font-black text-emerald-800 my-1">
              ₹{remainingAmountToPay}
            </div>

            <div className="bg-white/90 border border-emerald-200 rounded-xl p-3 mt-3 text-xs space-y-1.5 text-left">
              <div className="flex justify-between text-gray-700">
                <span>Items Subtotal:</span>
                <span className="font-bold text-gray-900">₹{order.subtotal}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>Delivery Fee:</span>
                <span className="font-bold text-gray-900">
                  {order.deliveryFee === 0 ? 'FREE' : `₹${order.deliveryFee}`}
                </span>
              </div>
              {order.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>Advance Online Discount:</span>
                  <span>-₹{order.discountAmount}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-900 font-extrabold pt-1 border-t border-gray-200">
                <span>Recalculated Order Total:</span>
                <span>₹{order.finalAmount}</span>
              </div>

              {walletAmountUsed > 0 && (
                <div className="flex justify-between text-emerald-700 font-bold">
                  <span>Wallet Applied:</span>
                  <span>-₹{walletAmountUsed}</span>
                </div>
              )}

              {previousOnlinePaid > 0 && (
                <div className="flex justify-between text-blue-700 font-bold">
                  <span>Already Paid Online:</span>
                  <span>-₹{previousOnlinePaid}</span>
                </div>
              )}

              <div className="flex justify-between text-emerald-900 font-black pt-1.5 border-t border-emerald-300 text-sm">
                <span>Balance to Pay Now:</span>
                <span>₹{remainingAmountToPay}</span>
              </div>
            </div>
          </div>

          {/* Select Online Payment App */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                Select Online Payment App:
              </p>
              <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Instant UPI / QR
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'PAYTM', name: 'Paytm', icon: '🔵' },
                { id: 'PHONEPE', name: 'PhonePe', icon: '🟣' },
                { id: 'GPAY', name: 'Google Pay', icon: '⚡' },
                { id: 'QR', name: 'Scan any QR', icon: '📱' },
              ].map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelectedUpiApp(app.id as any)}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    selectedUpiApp === app.id
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <span>{app.icon}</span>
                  <span>{app.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-2">
          <button
            type="button"
            id="confirm-edit-balance-payment-btn"
            disabled={isProcessing}
            onClick={handlePayNow}
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white py-3 px-4 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition cursor-pointer disabled:opacity-50"
          >
            <ShieldCheck size={18} />
            <span>
              {isProcessing
                ? 'Confirming Payment...'
                : `Authorize ₹${remainingAmountToPay} via ${
                    selectedUpiApp === 'PAYTM'
                      ? 'Paytm'
                      : selectedUpiApp === 'PHONEPE'
                      ? 'PhonePe'
                      : selectedUpiApp === 'GPAY'
                      ? 'Google Pay'
                      : 'UPI QR'
                  } & Mark Order Paid`}
            </span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full text-xs font-bold text-gray-500 hover:text-gray-800 py-1.5 text-center transition cursor-pointer"
          >
            Pay Later (Order remains UNPAID / PENDING until payment is confirmed)
          </button>
        </div>
      </div>
    </div>
  );
};
