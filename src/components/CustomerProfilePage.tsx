import React, { useState, useEffect } from 'react';
import { UserCheck, MapPin, Phone, Lock, ArrowRight, ShieldCheck, LogOut, ShoppingBag, Sparkles, Building } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';

interface CustomerProfilePageProps {
  onProfileSaved?: () => void;
  canCancel?: boolean;
  onCancel?: () => void;
}

export const CustomerProfilePage: React.FC<CustomerProfilePageProps> = ({
  onProfileSaved,
  canCancel = false,
  onCancel,
}) => {
  const { currentUser, saveCustomerProfile, logout, isSupabaseConfigured } = useApp();

  // Primary delivery address record
  const primaryAddress = currentUser.addresses && currentUser.addresses.length > 0 ? currentUser.addresses[0] : null;

  const [name, setName] = useState(currentUser.name || '');
  const [address, setAddress] = useState(primaryAddress?.fullAddress || '');
  const [landmark, setLandmark] = useState(primaryAddress?.landmark || '');
  const [pincode, setPincode] = useState(primaryAddress?.pincode || '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Keep fields synchronized strictly if currentUser changes, without stale cross-user leaks
  useEffect(() => {
    setName(currentUser.name || '');
    const currentPrimary = currentUser.addresses && currentUser.addresses.length > 0 ? currentUser.addresses[0] : null;
    setAddress(currentPrimary?.fullAddress || '');
    setLandmark(currentPrimary?.landmark || '');
    setPincode(currentPrimary?.pincode || '');
    setErrorMessage('');
    setSuccessMessage('');
  }, [currentUser.id, currentUser.phone, currentUser.name, currentUser.addresses]);

  const isNewCustomer = !primaryAddress || !primaryAddress.fullAddress.trim();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!name.trim()) {
      setErrorMessage('Please enter your full name to personalize your orders.');
      return;
    }

    if (!address.trim()) {
      setErrorMessage('Please enter your delivery street address or shop details in Nashik.');
      return;
    }

    setIsSaving(true);

    try {
      await saveCustomerProfile({
        name: name.trim(),
        fullAddress: address.trim(),
        landmark: landmark.trim(),
        pincode: pincode.trim(),
      });

      setSuccessMessage('Profile saved successfully! Proceeding to shop...');

      setTimeout(() => {
        if (onProfileSaved) {
          onProfileSaved();
        }
      }, 350);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-[88vh] bg-gradient-to-b from-gray-50 to-amber-50/20 py-8 px-4 sm:px-6 flex items-center justify-center animate-fadeIn">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Top Header Card */}
        <div className="bg-[#0F2C59] text-white p-6 sm:p-7 border-b-4 border-[#D4AF37] relative">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BrandLogo size="md" className="border border-white/20 rounded-xl" />
              <div>
                <span className="text-[10px] uppercase tracking-wider font-extrabold text-[#D4AF37] block">
                  Customer Flow Step 2
                </span>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                  Customer Profile
                </h1>
              </div>
            </div>

            <button
              onClick={logout}
              className="text-xs text-gray-300 hover:text-white flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition border border-white/10"
              title="Logout or switch to another customer"
            >
              <LogOut size={13} />
              <span>Switch Account</span>
            </button>
          </div>

          <p className="text-xs text-gray-300 mt-3 leading-relaxed">
            Please confirm your delivery details. We deliver directly to shops and residences across Nashik city.
          </p>

          {/* Account Status Badge */}
          <div className="mt-4 inline-flex items-center gap-2 bg-white/10 backdrop-blur-xs px-3 py-1 rounded-full text-xs font-semibold text-amber-200 border border-white/15">
            {isNewCustomer ? (
              <>
                <Sparkles size={13} className="text-[#D4AF37]" />
                <span>New Customer Registration &bull; Address initially blank</span>
              </>
            ) : (
              <>
                <UserCheck size={13} className="text-emerald-400" />
                <span>Existing Customer Verified &bull; Profile retrieved from database</span>
              </>
            )}
          </div>
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} className="p-6 sm:p-7 space-y-5">
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              <span>{successMessage}</span>
            </div>
          )}

          {/* 1. Contact Number (Locked & Sourced strictly from authenticated record) */}
          <div className="space-y-1.5">
            <label className="text-xs font-black text-gray-700 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Phone size={13} className="text-[#0F2C59]" />
                <span>Contact Number</span>
              </span>
              <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                <Lock size={10} /> Authenticated &amp; Locked
              </span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 font-mono font-bold text-gray-500 text-sm">
                +91
              </span>
              <input
                type="text"
                value={currentUser.phone}
                readOnly
                disabled
                className="w-full pl-12 pr-10 py-3 bg-gray-100/90 text-gray-700 border border-gray-300 rounded-xl font-mono text-sm font-bold cursor-not-allowed select-none shadow-xs"
              />
              <div className="absolute right-3 text-gray-400">
                <Lock size={16} />
              </div>
            </div>
            <p className="text-[10.5px] text-gray-500 flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500 shrink-0" />
              <span>Contact number is tied directly to your authenticated record and cannot be replaced.</span>
            </p>
          </div>

          {/* 2. Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-black text-gray-700 uppercase tracking-wider block">
              Customer Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajesh Gupta or Mahavir Kirana Stores"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition"
            />
          </div>

          {/* 3. Delivery Address */}
          <div className="space-y-1.5">
            <label className="text-xs font-black text-gray-700 uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MapPin size={13} className="text-[#FF6B00]" />
                <span>Delivery Address (Street / Shop / Building)</span>
              </span>
              <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter complete address in Nashik (e.g. Shop #4, Modern Kirana Stores, MG Road or Flat 402, Shanti Heights)"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition resize-none"
            />
            {isNewCustomer && !address && (
              <p className="text-[11px] text-amber-700 font-medium">
                &bull; Address is initially blank for new customers. Please enter your primary delivery location.
              </p>
            )}
          </div>

          {/* 4. Landmark */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-xs font-black text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Building size={13} className="text-[#0F2C59]" />
                <span>Landmark</span>
              </label>
              <input
                type="text"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                placeholder="e.g. Near Ganpati Mandir, Opp. D-Mart"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-black text-gray-700 uppercase tracking-wider block">
                Pincode
              </label>
              <input
                type="text"
                maxLength={6}
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                placeholder="422001"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-mono font-bold text-gray-800 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition"
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="pt-3 border-t border-gray-200 flex flex-col sm:flex-row items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full sm:flex-1 bg-[#0F2C59] hover:bg-[#153e7d] text-white font-extrabold py-3 px-5 rounded-xl transition shadow-md flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Saving to Database...</span>
                </>
              ) : (
                <>
                  <ShoppingBag size={17} className="text-[#D4AF37]" />
                  <span>Save Profile &amp; Continue to Shop</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            {canCancel && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="w-full sm:w-auto px-4 py-3 text-xs font-bold text-gray-600 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition text-center"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Supabase status notice */}
          <div className="text-[10.5px] text-gray-400 text-center flex items-center justify-center gap-1.5 pt-1">
            <span className={`w-2 h-2 rounded-full ${isSupabaseConfigured ? 'bg-emerald-500' : 'bg-blue-400'}`}></span>
            <span>
              {isSupabaseConfigured
                ? 'Profile changes synchronize directly with your Supabase database.'
                : 'Development storage active. Profile stays persisted across page refresh.'}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
};
