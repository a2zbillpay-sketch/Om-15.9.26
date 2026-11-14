import React from 'react';
import { X, Wallet } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface ReferralWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ReferralWalletModal: React.FC<ReferralWalletModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, customerOutstanding, walletTransactions } = useApp();

  if (!isOpen) return null;

  const cleanUserPhone = currentUser.phone ? currentUser.phone.replace(/\D/g, '').slice(-10) : '';

  const userTransactions = (walletTransactions || []).filter((tx) => {
    const txPhone = tx.userPhone ? tx.userPhone.replace(/\D/g, '').slice(-10) : '';
    return (
      tx.userId === currentUser.id ||
      (cleanUserPhone && txPhone === cleanUserPhone) ||
      (currentUser.phone && tx.userPhone === currentUser.phone)
    );
  });

  const walletBalance = Math.max(0, currentUser.walletBalance || 0);
  const displayAmount = `₹${walletBalance}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border-t-4 border-emerald-600 max-h-[90vh] flex flex-col justify-between">
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Wallet size={20} className="text-[#D4AF37]" />
            <h2 className="font-extrabold text-base text-[#D4AF37]">
              Store Wallet
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Balance Card */}
          <div className="text-white p-5 rounded-2xl shadow-lg relative overflow-hidden bg-gradient-to-br from-emerald-600 to-[#0F2C59]">
            <div className="relative z-10">
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
                Available Wallet Cash
              </div>
              <div className="text-3xl font-black tracking-tight text-white mt-1">
                {displayAmount}
              </div>
              <p className="text-[11px] mt-2 text-emerald-100">
                100% usable on your next Advance Payment! Automatically credited from order refunds.
              </p>
            </div>
            <div className="absolute right-[-10px] bottom-[-20px] opacity-15 text-white text-8xl font-black">
              ₹
            </div>
          </div>

          {/* Pending COD Outstanding Notice if applicable */}
          {customerOutstanding > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-rose-800 block">Pending COD Outstanding</span>
                <span className="text-[10px] text-rose-600">To be settled upon doorstep collection</span>
              </div>
              <span className="font-extrabold text-sm text-rose-700">₹{customerOutstanding}</span>
            </div>
          )}

          {/* Activity / Ledgers */}
          <div>
            <h4 className="text-xs font-bold text-gray-700 mb-2">Recent Wallet Activities</h4>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 text-xs max-h-48 overflow-y-auto">
              {userTransactions.length > 0 ? (
                userTransactions.map((tx) => (
                  <div key={tx.id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                    <div>
                      <div className="font-semibold text-gray-900">{tx.description}</div>
                      <div className="text-[10px] text-gray-400">
                        {tx.orderNumber ? `Order #${tx.orderNumber} • ` : ''}
                        {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className={`font-black ${tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {tx.type === 'DEBIT' ? `-₹${tx.amount}` : `+₹${tx.amount}`}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-gray-400 text-xs">
                  No wallet transactions yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0F2C59] text-white text-xs font-bold rounded-xl"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
