import React, { useState } from 'react';
import { ShoppingBag, Store, ShieldCheck, Phone, ArrowRight, UserPlus, UserCheck, Lock, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { BrandLogo } from './BrandLogo';
import { AdminLoginModal } from './AdminLoginModal';

interface CustomerAuthPageProps {
  onSuccess?: () => void;
}

export const CustomerAuthPage: React.FC<CustomerAuthPageProps> = ({ onSuccess }) => {
  const { loginWithPhone, setActiveRole } = useApp();

  const [activePortal, setActivePortal] = useState<'CUSTOMER' | 'SHOPKEEPER'>('CUSTOMER');
  const [customerMode, setCustomerMode] = useState<'NEW' | 'EXISTING'>('NEW');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);

  const handleCustomerLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');
    const cleanPhone = phone.replace(/\D/g, '');

    if (!cleanPhone || cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setIsLoading(true);

    try {
      await loginWithPhone(
        cleanPhone,
        Role.CUSTOMER,
        customerMode === 'NEW' ? name.trim() : undefined,
        { isExisting: customerMode === 'EXISTING' }
      );
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!adminPassword.trim()) {
      setError('Please enter your shopkeeper admin password.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: adminPassword.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.authenticated) {
        setError(data.error || 'Invalid credentials');
        return;
      }

      loginWithPhone('9876543210', Role.SHOPKEEPER, 'Om Prakash Sharma');
      setActiveRole(Role.SHOPKEEPER);
      if (onSuccess) onSuccess();
    } catch {
      setError('Authentication service unavailable. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[90vh] bg-gradient-to-b from-gray-50 via-white to-gray-100 py-10 px-4 sm:px-6 flex items-center justify-center animate-fadeIn">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Brand Banner */}
        <div className="bg-[#0F2C59] text-white p-7 sm:p-8 border-b-4 border-[#D4AF37] text-center relative">
          <div className="flex justify-center mb-3">
            <BrandLogo size="lg" className="border border-white/20 rounded-2xl" />
          </div>
          <span className="text-[10px] uppercase tracking-widest font-black text-[#D4AF37] bg-white/10 px-3 py-1 rounded-full border border-white/10 inline-block mb-2">
            Wholesale &amp; Retail Groceries &bull; Nashik City
          </span>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            OM DISTRIBUTORS
          </h1>
          <p className="text-xs text-gray-300 mt-1 max-w-md mx-auto leading-relaxed">
            Direct distributor pricing on daily staples, pulses, basmati rice &amp; wholesale essentials.
          </p>

          {/* Portal Switcher Tabs */}
          <div className="mt-6 flex bg-[#0a1e3d] p-1 rounded-2xl border border-white/15 max-w-xs mx-auto text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setActivePortal('CUSTOMER');
                setError('');
              }}
              className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
                activePortal === 'CUSTOMER'
                  ? 'bg-[#FF6B00] text-white shadow'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <ShoppingBag size={14} />
              <span>Customer</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActivePortal('SHOPKEEPER');
                setError('');
              }}
              className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
                activePortal === 'SHOPKEEPER'
                  ? 'bg-[#D4AF37] text-[#0F2C59] shadow font-black'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <Store size={14} />
              <span>Shopkeeper</span>
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0"></span>
              <span>{error}</span>
            </div>
          )}

          {activePortal === 'CUSTOMER' ? (
            <div className="space-y-6">
              {/* Customer Option Selector (1. New Customer, 2. Existing Customer) */}
              <div className="space-y-2">
                <label className="block text-[11px] font-black uppercase tracking-wider text-gray-500">
                  Select Customer Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Option 1: New Customer */}
                  <button
                    type="button"
                    id="customer-tab-new"
                    onClick={() => {
                      setCustomerMode('NEW');
                      setError('');
                    }}
                    className={`p-3.5 rounded-2xl border text-left transition relative flex flex-col justify-between ${
                      customerMode === 'NEW'
                        ? 'bg-orange-50/80 border-[#FF6B00] text-gray-900 shadow-sm ring-1 ring-[#FF6B00]'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-black text-[#FF6B00]">
                        <UserPlus size={16} />
                        <span>1. New Customer</span>
                      </span>
                      {customerMode === 'NEW' && (
                        <span className="w-2 h-2 rounded-full bg-[#FF6B00]"></span>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-500 leading-snug">
                      First-time grocery registration
                    </span>
                  </button>

                  {/* Option 2: Existing Customer */}
                  <button
                    type="button"
                    id="customer-tab-existing"
                    onClick={() => {
                      setCustomerMode('EXISTING');
                      setError('');
                    }}
                    className={`p-3.5 rounded-2xl border text-left transition relative flex flex-col justify-between ${
                      customerMode === 'EXISTING'
                        ? 'bg-blue-50/80 border-[#0F2C59] text-gray-900 shadow-sm ring-1 ring-[#0F2C59]'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-black text-[#0F2C59]">
                        <UserCheck size={16} className="text-emerald-600" />
                        <span>2. Existing Customer</span>
                      </span>
                      {customerMode === 'EXISTING' && (
                        <span className="w-2 h-2 rounded-full bg-[#0F2C59]"></span>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-500 leading-snug">
                      Auto-load saved profile &amp; address
                    </span>
                  </button>
                </div>
              </div>

              {/* Dynamic Customer Form */}
              <form onSubmit={handleCustomerLogin} className="space-y-4 pt-1">
                {customerMode === 'NEW' ? (
                  /* Option 1: New Customer Form */
                  <>
                    <div className="bg-orange-50/50 border border-orange-200/60 rounded-xl p-3 text-[11px] text-gray-600">
                      <strong className="text-[#FF6B00]">New Customer Registration:</strong> Enter your 10-digit mobile number below. You will set up your personalized delivery address in the next step.
                    </div>

                    <div>
                      <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                        Mobile Number <span className="text-rose-500">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="bg-gray-100 text-gray-700 font-mono font-bold px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm">
                          +91
                        </span>
                        <div className="relative flex-1">
                          <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="tel"
                            id="new-customer-mobile-input"
                            maxLength={10}
                            required
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                            placeholder="Enter your 10-digit mobile"
                            className="w-full pl-9 pr-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-mono font-bold text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#FF6B00] focus:border-transparent outline-none transition"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        Your mobile number will anchor your delivery account and contact details.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                        Your Full Name (Optional)
                      </label>
                      <input
                        type="text"
                        id="new-customer-name-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Ramesh Patil"
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#FF6B00] focus:border-transparent outline-none transition"
                      />
                    </div>

                    <button
                      type="submit"
                      id="new-customer-submit-btn"
                      disabled={isLoading}
                      className="w-full bg-[#FF6B00] hover:bg-[#e05e00] text-white font-extrabold py-3 px-5 rounded-xl transition shadow-md flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>Creating Customer Profile...</span>
                        </>
                      ) : (
                        <>
                          <span>Continue as New Customer</span>
                          <ArrowRight size={16} className="text-white" />
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  /* Option 2: Existing Customer Form */
                  <>
                    <div className="bg-blue-50/50 border border-blue-200/60 rounded-xl p-3 text-[11px] text-gray-600">
                      <strong className="text-[#0F2C59]">Existing Customer Sign-In:</strong> Enter your registered 10-digit mobile number. Your saved delivery name, address, and landmark will be retrieved automatically.
                    </div>

                    <div>
                      <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                        Registered Mobile Number <span className="text-rose-500">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="bg-gray-100 text-gray-700 font-mono font-bold px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm">
                          +91
                        </span>
                        <div className="relative flex-1">
                          <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="tel"
                            id="existing-customer-mobile-input"
                            maxLength={10}
                            required
                            value={phone}
                            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                            placeholder="Enter saved 10-digit mobile"
                            className="w-full pl-9 pr-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-mono font-bold text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        If this mobile number is found in the database, your saved address will be preloaded.
                      </p>
                    </div>

                    <button
                      type="submit"
                      id="existing-customer-submit-btn"
                      disabled={isLoading}
                      className="w-full bg-[#0F2C59] hover:bg-[#153e7d] text-white font-extrabold py-3 px-5 rounded-xl transition shadow-md flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                    >
                      {isLoading ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          <span>Looking up Customer Record...</span>
                        </>
                      ) : (
                        <>
                          <span>Load Saved Profile &amp; Continue</span>
                          <ArrowRight size={16} className="text-[#D4AF37]" />
                        </>
                      )}
                    </button>
                  </>
                )}
              </form>
            </div>
          ) : (
            /* Shopkeeper Login Form */
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                  Shopkeeper Admin Password
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showAdminPassword ? 'text' : 'password'}
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full pl-9 pr-10 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-800 focus:ring-2 focus:ring-[#0F2C59] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showAdminPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[11px] text-gray-500">
                    Owner portal for wholesale fulfillment &amp; controls.
                  </p>
                  <button
                    type="button"
                    id="shopkeeper-auth-forgot-password-btn"
                    onClick={() => setIsRecoveryModalOpen(true)}
                    className="text-xs font-bold text-[#0F2C59] hover:underline shrink-0"
                  >
                    Forgot Password?
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#D4AF37] hover:bg-[#b89528] text-[#0F2C59] font-black py-3 px-5 rounded-xl transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-[#0F2C59] border-t-transparent rounded-full animate-spin"></span>
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    <span>Enter Shopkeeper Admin Center</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Delivery Region Notice */}
          <div className="pt-4 border-t border-gray-100 flex items-center justify-center gap-2 text-center text-[11px] text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
            <span>We provide home delivery of groceries and essential items only within Nashik city.</span>
          </div>
        </div>
      </div>

      {/* Admin Password Recovery & Reset Modal */}
      <AdminLoginModal
        isOpen={isRecoveryModalOpen}
        initialMode="FORGOT_PASSWORD"
        onClose={() => setIsRecoveryModalOpen(false)}
        onSuccess={() => {
          setIsRecoveryModalOpen(false);
          loginWithPhone('9876543210', Role.SHOPKEEPER, 'Om Prakash Sharma');
          setActiveRole(Role.SHOPKEEPER);
          if (onSuccess) onSuccess();
        }}
      />
    </div>
  );
};
