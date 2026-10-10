import React, { useState, useEffect } from 'react';
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
  Wallet,
  AlertTriangle,
  Navigation,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Address, PaymentMethod, Order, GoogleLocation } from '../types';
import { DualPaymentModal } from './DualPaymentModal';
import { GoogleLocationPickerModal } from './GoogleLocationPickerModal';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderSuccess: (orderId: string, order?: Order) => void;
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
    useWalletBalance,
    setUseWalletBalance,
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
  const [selectedUpiApp, setSelectedUpiApp] = useState<'PAYTM' | 'PHONEPE' | 'GPAY' | 'QR'>('QR');
  const [walletErrorMessage, setWalletErrorMessage] = useState<string | null>(null);
  const [applyWalletInAdvance, setApplyWalletInAdvance] = useState(true);

  // Google Location Picker state
  const [isGoogleLocationPickerOpen, setIsGoogleLocationPickerOpen] = useState(false);
  const [selectedGoogleLocation, setSelectedGoogleLocation] = useState<GoogleLocation | null>(null);

  const currentSelectedAddress =
    userAddresses.find((a) => a.id === selectedAddressId) || userAddresses[0];

  // Sync selected google location with address on change
  useEffect(() => {
    if (isOpen && currentSelectedAddress?.googleLocation) {
      setSelectedGoogleLocation(currentSelectedAddress.googleLocation);
    }
  }, [isOpen, currentSelectedAddress?.id, currentSelectedAddress?.googleLocation]);

  if (!isOpen) return null;

  const handleSaveNewAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddressForm.fullAddress.trim() || !newAddressForm.pincode.trim()) {
      return;
    }
    addAddress({
      ...newAddressForm,
      googleLocation: selectedGoogleLocation || undefined,
    });
    setIsAddingNewAddress(false);
    setNewAddressForm({ fullAddress: '', landmark: '', pincode: '400705' });
  };

  const handleProceedToPayment = () => {
    if (!currentSelectedAddress) {
      alert('Please select or add a delivery address.');
      return;
    }
    setWalletErrorMessage(null);
    setIsDualPaymentOpen(true);
  };

  const handleSelectPaymentMethod = async (
    method: PaymentMethod,
    app?: 'PAYTM' | 'PHONEPE' | 'GPAY' | 'QR'
  ) => {
    setWalletErrorMessage(null);
    if (method === PaymentMethod.ADVANCE_ONLINE) {
      if (app) {
        setSelectedUpiApp(app);
      }
      setIsDualPaymentOpen(false);
      // Trigger simulated UPI / Razorpay Gateway
      setIsSimulatingRazorpay(true);
    } else {
      // Cash On Delivery Placement - triggered strictly via "Confirm COD Order" button
      // Wallet deduction is strictly ₹0 for COD (never used or reduced)
      try {
        const order = await createOrder({
          address: currentSelectedAddress,
          paymentMethod: PaymentMethod.COD,
          deliveryDate,
          useWallet: false,
          googleLocation: selectedGoogleLocation || currentSelectedAddress?.googleLocation,
        });
        setIsDualPaymentOpen(false);
        onClose();
        onOrderSuccess(order.id, order);
      } catch (err) {
        console.error('Error creating COD order:', err);
        throw err;
      }
    }
  };

  const handleCompleteAdvancePayment = async () => {
    setWalletErrorMessage(null);
    try {
      const order = await createOrder({
        address: currentSelectedAddress,
        paymentMethod: PaymentMethod.ADVANCE_ONLINE,
        deliveryDate,
        useWallet: applyWalletInAdvance,
        selectedPaymentApp: selectedUpiApp,
        googleLocation: selectedGoogleLocation || currentSelectedAddress?.googleLocation,
      });
      setIsSimulatingRazorpay(false);
      onClose();
      onOrderSuccess(order.id, order);
    } catch (err: any) {
      console.error('Error creating advance order:', err);
    }
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
            {walletErrorMessage && (
              <div
                id="checkout-step1-wallet-error"
                className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs font-bold rounded-xl flex items-center gap-2"
              >
                <AlertTriangle size={16} className="text-red-600 shrink-0" />
                <span>{walletErrorMessage}</span>
              </div>
            )}

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

            {/* Store Wallet Balance Info */}
            {currentUser.walletBalance > 0 && (
              <div
                id="checkout-wallet-balance-banner"
                className="bg-emerald-50/90 border-2 border-emerald-400 rounded-xl p-3.5 flex items-center justify-between shadow-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    <Wallet size={18} />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-emerald-950 flex items-center gap-1.5">
                      <span>Available Wallet Balance</span>
                      <span className="bg-emerald-200 text-emerald-900 text-[10px] font-black px-1.5 py-0.2 rounded">
                        Refund Credit
                      </span>
                    </div>
                    <div className="text-sm font-black text-emerald-800">
                      ₹{currentUser.walletBalance}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-emerald-800 font-bold bg-emerald-100/90 px-2.5 py-1 rounded-md border border-emerald-300 block">
                    Applied in Advance Payment
                  </span>
                </div>
              </div>
            )}

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

              {/* Google Maps Location Section in Customer Delivery Details */}
              <div className="mt-3">
                {selectedGoogleLocation ? (
                  <div className="p-3.5 rounded-xl border-2 border-emerald-300 bg-emerald-50/80 flex items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                        <CheckCircle2 size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-emerald-950 flex items-center gap-1.5 flex-wrap">
                          <span>Google Location Attached</span>
                          <span className="text-[10px] bg-emerald-200 text-emerald-900 font-bold px-1.5 py-0.2 rounded">
                            GPS Saved
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-emerald-900 line-clamp-1 mt-0.5">
                          {selectedGoogleLocation.formattedAddress ||
                            `Lat: ${selectedGoogleLocation.latitude}, Lng: ${selectedGoogleLocation.longitude}`}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <a
                            href={
                              selectedGoogleLocation.mapsUrl ||
                              `https://www.google.com/maps?q=${selectedGoogleLocation.latitude},${selectedGoogleLocation.longitude}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-bold text-blue-700 hover:text-blue-900 underline flex items-center gap-1"
                            title="Open pin in Google Maps"
                          >
                            <ExternalLink size={10} />
                            <span>Verify on Google Maps</span>
                          </a>
                          <span className="text-[10px] text-gray-400">•</span>
                          <span className="text-[10px] font-mono text-gray-600">
                            {Number(selectedGoogleLocation.latitude)?.toFixed
                              ? Number(selectedGoogleLocation.latitude).toFixed(4)
                              : selectedGoogleLocation.latitude}
                            ,{' '}
                            {Number(selectedGoogleLocation.longitude)?.toFixed
                              ? Number(selectedGoogleLocation.longitude).toFixed(4)
                              : selectedGoogleLocation.longitude}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      id="btn-change-location"
                      onClick={() => setIsGoogleLocationPickerOpen(true)}
                      className="px-3 py-1.5 bg-white hover:bg-gray-100 text-[#0F2C59] border border-gray-300 text-xs font-bold rounded-lg shadow-2xs transition shrink-0 cursor-pointer active:scale-95"
                      title="Change Google Maps delivery pin"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/90 via-sky-50/60 to-amber-50/40 flex items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#0F2C59] text-[#D4AF37] flex items-center justify-center shrink-0 shadow-xs">
                        <Navigation size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-[#0F2C59] flex items-center gap-1.5">
                          <span>Google Maps Location</span>
                          <span className="text-[10px] font-semibold text-gray-500 font-normal">(Optional GPS)</span>
                        </div>
                        <p className="text-[11px] text-gray-600 truncate">
                          Pinpoint exact delivery shop or home on Google Maps
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      id="btn-add-location"
                      onClick={() => setIsGoogleLocationPickerOpen(true)}
                      className="px-3.5 py-2 bg-[#0F2C59] hover:bg-[#153e7d] text-[#D4AF37] hover:text-amber-200 text-xs font-extrabold rounded-xl shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 border border-[#D4AF37]/30"
                      title="Open Google Maps Location Picker"
                    >
                      <MapPin size={13} className="text-[#FF6B00]" />
                      <span>Add Location</span>
                    </button>
                  </div>
                )}
              </div>
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

            {/* Advance Payment Breakdown */}
            {(() => {
              const advanceTotal = checkoutBreakdown.advanceFinalTotal;
              const isUsingWallet = applyWalletInAdvance && (currentUser.walletBalance || 0) > 0;
              const advanceWalletCredit = isUsingWallet
                ? Math.min(Math.max(0, currentUser.walletBalance || 0), advanceTotal)
                : 0;
              const remainingOnlinePayment = Math.max(0, advanceTotal - advanceWalletCredit);
              const remainingWalletAfter = isUsingWallet
                ? Math.max(0, (currentUser.walletBalance || 0) - advanceWalletCredit)
                : Math.max(0, currentUser.walletBalance || 0);

              return (
                <>
                  {currentUser.walletBalance > 0 && (
                    <label
                      id="advance-wallet-checkbox-toggle"
                      className="flex items-center justify-between p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl mb-3 cursor-pointer hover:bg-emerald-100/60 transition shadow-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Wallet size={16} className="text-emerald-700 shrink-0" />
                        <div className="text-left">
                          <div className="text-xs font-black text-emerald-950">
                            Apply Wallet Balance (Advance)
                          </div>
                          <div className="text-[10px] text-emerald-700 font-semibold">
                            Available: ₹{currentUser.walletBalance}
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={applyWalletInAdvance}
                        onChange={(e) => setApplyWalletInAdvance(e.target.checked)}
                        className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
                      />
                    </label>
                  )}

                  <div className="bg-emerald-50 p-3 rounded-xl mb-4 text-center border border-emerald-200">
                    <div className="text-[11px] text-emerald-800 font-semibold">UPI Payment</div>
                    <div className="text-2xl font-black text-emerald-800">
                      ₹{remainingOnlinePayment}
                    </div>
                    <div className="bg-white/80 border border-emerald-200 rounded-lg p-2 mt-2 space-y-1 text-xs text-left">
                      <div className="flex justify-between text-gray-600">
                        <span>Items Subtotal:</span>
                        <span className="font-semibold text-gray-800">₹{checkoutBreakdown.subtotal}</span>
                      </div>
                      {checkoutBreakdown.advanceDiscountAmount > 0 && (
                        <div className="flex justify-between text-emerald-700 font-bold">
                          <span>Advance Discount:</span>
                          <span>-₹{checkoutBreakdown.advanceDiscountAmount}</span>
                        </div>
                      )}
                      {advanceWalletCredit > 0 ? (
                        <div className="flex justify-between text-emerald-700 font-bold">
                          <span>Wallet Applied (Advance):</span>
                          <span>-₹{advanceWalletCredit}</span>
                        </div>
                      ) : null}
                      <div className="border-t border-emerald-200 pt-1 flex justify-between font-bold text-emerald-900">
                        <span>Final Bill:</span>
                        <span className="font-black text-emerald-800">
                          ₹{remainingOnlinePayment}
                        </span>
                      </div>
                      {advanceWalletCredit > 0 && (
                        <div className="text-[10px] text-emerald-700 font-medium text-right pt-0.5">
                          Wallet balance after payment: ₹{remainingWalletAfter}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-emerald-700 font-bold mt-1">
                      {checkoutBreakdown.advanceDiscountAmount > 0
                        ? `Includes ₹${checkoutBreakdown.advanceDiscountAmount} Instant Advance Discount (Applied on eligible items)`
                        : checkoutBreakdown.excludedSubtotal > 0
                        ? 'Price Regulated items in cart (Discount excluded)'
                        : ''}
                    </div>
                  </div>

                  {remainingOnlinePayment > 0 ? (
                    <div className="space-y-2 mb-5">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <p className="text-[11px] font-bold text-gray-600 uppercase">Select Online Payment App:</p>
                        <div
                          id="checkout-advance-payment-methods-text"
                          className="text-[10px] font-extrabold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200"
                        >
                          Paytm | PhonePe | Google Pay | Scan any QR
                        </div>
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
                            onClick={() => {
                              setSelectedUpiApp(app.id as any);
                            }}
                            className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                              selectedUpiApp === app.id
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20 shadow-xs'
                                : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            <span>{app.icon}</span>
                            <span>{app.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-emerald-100/90 border border-emerald-300 rounded-xl p-3 mb-5 text-center text-xs text-emerald-900 font-bold">
                      Full order amount covered by Wallet Applied (Advance).
                    </div>
                  )}

                  <button
                    id="confirm-simulated-payment-btn"
                    onClick={handleCompleteAdvancePayment}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-xl shadow-md transition text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck size={16} />
                    <span>
                      {remainingOnlinePayment === 0
                        ? 'Confirm Advance Order (Fully covered by Wallet Applied (Advance))'
                        : `Authorize ₹${remainingOnlinePayment} via ${
                            selectedUpiApp === 'PAYTM'
                              ? 'Paytm'
                              : selectedUpiApp === 'PHONEPE'
                              ? 'PhonePe'
                              : selectedUpiApp === 'GPAY'
                              ? 'Google Pay'
                              : 'UPI QR Code'
                          } & Confirm Order`}
                    </span>
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Google Maps Location Picker Modal */}
      <GoogleLocationPickerModal
        isOpen={isGoogleLocationPickerOpen}
        onClose={() => setIsGoogleLocationPickerOpen(false)}
        onSelectLocation={(loc) => {
          setSelectedGoogleLocation(loc);
          if (currentSelectedAddress) {
            currentSelectedAddress.googleLocation = loc;
          }
        }}
        initialLocation={selectedGoogleLocation}
      />
    </>
  );
};
