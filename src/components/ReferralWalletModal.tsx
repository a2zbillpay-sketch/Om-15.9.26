import React, { useState } from 'react';
import { X, Wallet, Share2, Copy, Check, Gift, ArrowUpRight, MessageSquare } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface ReferralWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ReferralWalletModal: React.FC<ReferralWalletModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, settings, customerOutstanding, walletTransactions } = useApp();
  const [copied, setCopied] = useState(false);

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

  const effectiveWalletBalance = customerOutstanding > 0 ? -customerOutstanding : (currentUser.walletBalance || 0);
  const isNegativeWallet = effectiveWalletBalance < 0;
  const displayAmount = isNegativeWallet
    ? `-₹${Math.abs(effectiveWalletBalance)}`
    : `₹${effectiveWalletBalance}`;

  const referralMessage = `Get wholesale and retail groceries delivered fast from ${settings.appName}! Use my referral code *${currentUser.referralCode}* to get ₹${settings.referralRewardAmount} wallet cash on your first order.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentUser.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsAppShare = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(referralMessage)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className={`bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border-t-4 max-h-[90vh] flex flex-col justify-between ${isNegativeWallet ? 'border-rose-600' : 'border-emerald-600'}`}>
        {/* Header */}
        <div className="p-4 bg-[#0F2C59] text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Wallet size={20} className={isNegativeWallet ? "text-rose-400" : "text-[#D4AF37]"} />
            <h2 className="font-extrabold text-base text-[#D4AF37]">
              Store Wallet & Referrals
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
          <div className={`text-white p-5 rounded-2xl shadow-lg relative overflow-hidden ${
            isNegativeWallet
              ? 'bg-gradient-to-br from-rose-700 to-[#0F2C59]'
              : 'bg-gradient-to-br from-emerald-600 to-[#0F2C59]'
          }`}>
            <div className="relative z-10">
              <div className={`text-xs font-semibold uppercase tracking-wider ${
                isNegativeWallet ? 'text-rose-200' : 'text-emerald-200'
              }`}>
                {isNegativeWallet ? 'Wallet Balance' : 'Available Wallet Cash'}
              </div>
              <div className="text-3xl font-black tracking-tight text-white mt-1">
                {displayAmount}
              </div>
              <p className={`text-[11px] mt-2 ${
                isNegativeWallet ? 'text-rose-100' : 'text-emerald-100'
              }`}>
                {isNegativeWallet
                  ? 'Outstanding balance from previous order to be settled upon doorstep collection.'
                  : '100% usable on your next Advance Payment! Automatically credited from refunds and referrals.'}
              </p>
            </div>
            <div className="absolute right-[-10px] bottom-[-20px] opacity-15 text-white text-8xl font-black">
              ₹
            </div>
          </div>

          {/* Referral Engine */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-900">
              <Gift size={18} className="text-[#FF6B00]" />
              <h3 className="font-bold text-xs">Refer Friends & Earn ₹{settings.referralRewardAmount} Each</h3>
            </div>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              Share your unique distributor invite code. When a friend places their first grocery order, you both get ₹{settings.referralRewardAmount} credited to your wallets!
            </p>

            {/* Code Copy Box */}
            <div className="flex items-center justify-between bg-white border-2 border-dashed border-[#D4AF37] rounded-xl p-2.5">
              <div>
                <span className="text-[9px] font-bold text-gray-400 block uppercase">Your Referral Code</span>
                <span className="text-base font-black font-mono tracking-widest text-[#0F2C59]">
                  {currentUser.referralCode}
                </span>
              </div>
              <button
                id="copy-referral-code-btn"
                onClick={handleCopy}
                className="bg-[#0F2C59] text-[#D4AF37] hover:bg-[#153e7d] text-xs font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 transition"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            {/* WhatsApp Share Button */}
            <button
              id="share-whatsapp-referral-btn"
              onClick={handleWhatsAppShare}
              className="w-full bg-[#25D366] hover:bg-[#20ba5a] text-white font-bold text-xs py-2.5 rounded-xl shadow transition flex items-center justify-center gap-2"
            >
              <MessageSquare size={16} />
              <span>Share Code on WhatsApp</span>
            </button>
          </div>

          {/* Activity / Ledgers */}
          <div>
            <h4 className="text-xs font-bold text-gray-700 mb-2">Recent Wallet Activities</h4>
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 text-xs max-h-48 overflow-y-auto">
              {userTransactions.length > 0 &&
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
                ))}
              <div className="p-3 flex justify-between items-center">
                <div>
                  <div className="font-semibold text-gray-900">Welcome Signup Bonus</div>
                  <div className="text-[10px] text-gray-400">Account Activation</div>
                </div>
                <div className="font-black text-emerald-600">+₹100</div>
              </div>
              <div className="p-3 flex justify-between items-center">
                <div>
                  <div className="font-semibold text-gray-900">Referral Friend Bonus</div>
                  <div className="text-[10px] text-gray-400">Suresh Verma 1st Order</div>
                </div>
                <div className="font-black text-emerald-600">+₹50</div>
              </div>
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
