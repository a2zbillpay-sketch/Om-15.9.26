import React from 'react';
import { X, ShieldCheck, FileText, RotateCcw } from 'lucide-react';

export type PolicyType = 'TERMS' | 'PRIVACY' | 'REFUND';

interface StorePolicyModalProps {
  policyType: PolicyType | null;
  onClose: () => void;
}

export const StorePolicyModal: React.FC<StorePolicyModalProps> = ({ policyType, onClose }) => {
  if (!policyType) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-gray-200 max-h-[85vh] flex flex-col justify-between">
        {/* Modal Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex items-center justify-between border-b border-[#D4AF37]/30">
          <div className="flex items-center gap-2">
            {policyType === 'TERMS' && <FileText className="text-[#D4AF37]" size={18} />}
            {policyType === 'PRIVACY' && <ShieldCheck className="text-emerald-400" size={18} />}
            {policyType === 'REFUND' && <RotateCcw className="text-amber-400" size={18} />}
            <h2 className="font-extrabold text-sm sm:text-base text-white">
              {policyType === 'TERMS' && 'Wholesale & Retail Commercial Terms'}
              {policyType === 'PRIVACY' && 'Customer Data & Privacy Policy'}
              {policyType === 'REFUND' && '15-Minute Cancellation & Refund Policy'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition"
            aria-label="Close policy modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-gray-700 leading-relaxed flex-1">
          {policyType === 'TERMS' && (
            <>
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-900 font-bold">
                Om Distributors delivers exclusively within Nashik city municipal limits.
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">1. Minimum Order & Free Shipping</h4>
                <p>Orders totaling ₹500 or more receive free doorstep delivery. Standard delivery charges apply to smaller basket sizes.</p>
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">2. Wholesale Tier Discounts</h4>
                <p>Bulk volume pricing applies automatically when adding commercial kattas (25 KG / 30 KG / 50 KG) to your cart.</p>
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">3. Cash on Delivery (COD) Privilege</h4>
                <p>First 3 COD grocery orders incur ₹0 extra handling fee. Subsequent COD orders carry a nominal ₹30 handling charge.</p>
              </div>
            </>
          )}

          {policyType === 'PRIVACY' && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-emerald-900 font-bold">
                We protect your mobile number and commercial delivery addresses.
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">1. Account Authentication</h4>
                <p>Customer accounts are identified strictly by mobile number. Your account remains synchronized regardless of whether you access via Chrome, Samsung Internet, Safari, or another supported browser.</p>
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">2. Delivery Communication</h4>
                <p>Your phone number and landmark are used solely for order confirmation, live delivery updates, and driver navigation.</p>
              </div>
            </>
          )}

          {policyType === 'REFUND' && (
            <>
              <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-[#0F2C59] font-bold">
                Hassle-free 15-minute instant cancellation window on all new orders.
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">1. 15-Minute Cancellation</h4>
                <p>Any order can be cancelled directly from your Order History screen within 15 minutes of placement before packing commences.</p>
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900 mb-1">2. Instant Wallet Credit</h4>
                <p>Advance UPI payments on cancelled orders are refunded instantly into your store wallet balance for seamless reuse.</p>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0F2C59] text-white text-xs font-bold rounded-xl hover:bg-[#163a6e] transition"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
