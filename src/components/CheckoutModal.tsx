import React, { useState } from 'react';
import {
  X,
  MapPin,
  Calendar,
  Plus,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  QrCode,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Address, PaymentMethod } from '../types';
import { DualPaymentModal } from './DualPaymentModal';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderSuccess: (orderId: string) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  onOrderSuccess,
}) => {
  const {
    currentUser,
    userAddresses,
    addAddress,
    selectedAddressId,
    setSelectedAddressId,
    checkoutBreakdown,
    createOrder,
  } = useApp();

  const [isDualPaymentOpen, setIsDualPaymentOpen] = useState(false);
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(false);
  const [newAddressForm, setNewAddressForm] = useState({
    fullAddress: '',
    landmark: '',
    pincode: '400705',
  });

  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0];
  const [deliveryDate, setDeliveryDate] = useState(tomorrow);

  // Simulated Razorpay Modal State
  const [isSimulatingRazorpay, setIsSimulatingRazorpay] = useState(false);
  const [selectedUpiApp, setSelectedUpiApp] = useState<'GPAY' | 'PHONEPE' | 'PAYTM' | 'QR'>('GPAY');

  if (!isOpen) return null;

  const currentSelectedAddress =
    userAddresses.find((a) => a.id === selectedAddressId) || userAddresses[0];

  const handleSaveNewAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddressForm.fullAddress.trim() || !newAddressForm.pincode.trim()) {
      return;
    }
    addAddress(newAddressForm);
    setIsAddingNewAddress(false);
    setNewAddressForm({ fullAddress: '', landmark: '', pincode: '400705' });
  };

  const handleProceedToPayment = () => {
    if (!currentSelectedAddress) {
      alert('Please select or add a delivery address.');
      return;
    }
    setIsDualPaymentOpen(true);
  };

  const handleSelectPaymentMethod = async (method: PaymentMethod) => {
    if (method === PaymentMethod.ADVANCE_ONLINE) {
      setIsDualPaymentOpen(false);
      // Trigger simulated UPI / Razorpay Gateway
      setIsSimulatingRazorpay(true);
    } else {
      // Cash On Delivery Placement - triggered strictly via "Confirm COD Order" button
      try {
        const order = await createOrder({
          address: currentSelectedAddress,
          paymentMethod: PaymentMethod.COD,
          deliveryDate,
        });
        setIsDualPaymentOpen(false);
        onClose();
        onOrderSuccess(order.id);
      } catch (err) {
        console.error('Error creating COD order:', err);
        throw err;
      }
    }
  };

  const handleCompleteAdvancePayment = async () => {
    const order = await createOrder({
      address: currentSelectedAddress,
      paymentMethod: PaymentMethod.ADVANCE_ONLINE,
      deliveryDate,
    });
    setIsSimulatingRazorpay(false);
    onClose();
    onOrderSuccess(order.id);
  };

  return (
    <>
      <div
        id="checkout-modal"
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      >
        <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border-t-4 border-[#D4AF37] max-h-[90vh] flex flex-col justify-between">
          {/* Header */}
          <div className="p-4 bg-[#0F2C59] text-white flex justify-between items-center">
            <div>
              <h2 className="font-extrabold text-base text-[#D4AF37]">Checkout & Delivery Details</h2>
              <p className="text-[11px] text-gray-300">Step 1: Confirm Delivery Address & Schedule</p>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto space-y-5 flex-1">
            {/* Customer Recipient Info */}
            <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 flex justify-between items-center text-xs">
              <div>
                <div className="font-bold text-gray-900">{currentUser.name}</div>
                <div className="text-gray-500 font-mono">+91 {currentUser.phone}</div>
              </div>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded">
                Verified Recipient
              </span>
            </div>

            {/* Address Selection */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <MapPin size={14} className="text-[#FF6B00]" />
                  <span>Delivery Address</span>
                </label>
                {!isAddingNewAddress && (
                  <button
                    onClick={() => setIsAddingNewAddress(true)}
                    className="text-[11px] font-bold text-[#0F2C59] hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Add New Address
                  </button>
                )}
              </div>

              {isAddingNewAddress ? (
                <form onSubmit={handleSaveNewAddress} className="bg-gray-50 p-3.5 rounded-xl border border-gray-300 space-y-3">
                  <div className="text-xs font-bold text-gray-800">New Delivery Location</div>
                  <textarea
                    required
                    placeholder="House / Shop #, Building Name, Street / Road Area"
                    value={newAddressForm.fullAddress}
                    onChange={(e) => setNewAddressForm({ ...newAddressForm, fullAddress: e.target.value })}
                    className="w-full p-2 text-xs border border-gray-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-[#0F2C59]"
                    rows={2}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Landmark (Optional)"
                      value={newAddressForm.landmark}
                      onChange={(e) => setNewAddressForm({ ...newAddressForm, landmark: e.target.value })}
                      className="p-2 text-xs border border-gray-300 rounded-lg bg-white outline-none"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Pincode (e.g. 400705)"
                      value={newAddressForm.pincode}
                      onChange={(e) => setNewAddressForm({ ...newAddressForm, pincode: e.target.value })}
                      className="p-2 text-xs border border-gray-300 rounded-lg bg-white outline-none font-mono"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingNewAddress(false)}
                      className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs bg-[#0F2C59] text-white font-bold rounded-lg"
                    >
                      Save Address
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2">
                  {userAddresses.map((addr) => (
                    <div
                      key={addr.id}
                      onClick={() => setSelectedAddressId(addr.id)}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition flex items-start justify-between ${
                        selectedAddressId === addr.id
                          ? 'border-[#0F2C59] bg-[#0F2C59]/5 ring-2 ring-[#0F2C59]/20'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div>
                        <p className="font-semibold text-gray-800">{addr.fullAddress}</p>
                        {addr.landmark && (
                          <p className="text-[11px] text-gray-500">Landmark: {addr.landmark}</p>
                        )}
                        <p className="text-[11px] font-mono font-bold text-gray-600">Pincode: {addr.pincode}</p>
                      </div>
                      {selectedAddressId === addr.id && (
                        <CheckCircle2 size={16} className="text-[#0F2C59] shrink-0 mt-0.5" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delivery Date / Slot */}
            <div>
              <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-1.5">
                <Calendar size={14} className="text-[#FF6B00]" />
                <span>Preferred Delivery Date</span>
              </label>
              <input
                type="date"
                min={new Date().toISOString().split('T')[0]}
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full p-2.5 text-xs border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-[#0F2C59]"
              />
              <span className="text-[10px] text-gray-500 mt-1 block">
                Standard grocery delivery dispatched by 11:00 AM & 4:00 PM slots daily.
              </span>
            </div>
          </div>

          {/* Bottom Action */}
          <div className="p-4 bg-gray-50 border-t border-gray-200">
            <button
              id="choose-payment-modal-trigger-btn"
              onClick={handleProceedToPayment}
              className="w-full bg-[#0F2C59] hover:bg-[#153e7d] text-white p-3.5 rounded-xl font-extrabold text-sm flex items-center justify-between shadow-lg transition"
            >
              <div className="text-left">
                <div className="text-[10px] text-[#D4AF37]">NEXT STEP</div>
                <div className="text-sm font-black">Choose Payment (Compare COD vs Advance)</div>
              </div>
              <ArrowRight size={18} className="text-[#D4AF37]" />
            </button>
          </div>
        </div>
      </div>

      {/* Dual Payment Modal (As required by prompt) */}
      <DualPaymentModal
        isOpen={isDualPaymentOpen}
        onClose={() => setIsDualPaymentOpen(false)}
        breakdown={checkoutBreakdown}
        onSelectPayment={handleSelectPaymentMethod}
      />

      {/* Simulated Razorpay / UPI Gateway Modal */}
      {isSimulatingRazorpay && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 border-t-8 border-emerald-600">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck size={20} className="text-emerald-600" />
                <span className="font-extrabold text-sm text-[#0F2C59]">Razorpay UPI Gateway</span>
              </div>
              <button onClick={() => setIsSimulatingRazorpay(false)} className="text-gray-400 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>

            <div className="bg-emerald-50 p-3 rounded-xl mb-4 text-center border border-emerald-200">
              <div className="text-[11px] text-emerald-800 font-semibold">Advance Payment Amount</div>
              <div className="text-2xl font-black text-emerald-800">₹{checkoutBreakdown.advanceFinalTotal}</div>
              <div className="text-[10px] text-emerald-700 font-bold mt-0.5">
                Includes {checkoutBreakdown.advanceDiscountAmount > 0 ? `₹${checkoutBreakdown.advanceDiscountAmount} Instant Advance Discount` : ''}
              </div>
            </div>

            <div className="space-y-2 mb-5">
              <p className="text-[11px] font-bold text-gray-600 uppercase">Select Fast UPI App:</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'GPAY', name: 'Google Pay', icon: '⚡' },
                  { id: 'PHONEPE', name: 'PhonePe', icon: '🟣' },
                  { id: 'PAYTM', name: 'Paytm UPI', icon: '🔵' },
                  { id: 'QR', name: 'Scan Any QR', icon: '📱' },
                ].map((app) => (
                  <button
                    key={app.id}
                    onClick={() => setSelectedUpiApp(app.id as any)}
                    className={`p-2 rounded-xl border text-xs font-bold flex items-center gap-2 transition ${
                      selectedUpiApp === app.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span>{app.icon}</span>
                    <span>{app.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              id="confirm-simulated-payment-btn"
              onClick={handleCompleteAdvancePayment}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-xl shadow-md transition text-xs flex items-center justify-center gap-2"
            >
              <ShieldCheck size={16} />
              <span>Authorize ₹{checkoutBreakdown.advanceFinalTotal} & Confirm Order</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
