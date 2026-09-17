import React, { useState } from 'react';
import { ShoppingBag, Store, ShieldCheck, Phone, ArrowRight, UserPlus, Sparkles, UserCheck, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { BrandLogo } from './BrandLogo';

interface CustomerAuthPageProps {
  onSuccess?: () => void;
}

export const CustomerAuthPage: React.FC<CustomerAuthPageProps> = ({ onSuccess }) => {
  const { loginWithPhone, setActiveRole } = useApp();

  const [activePortal, setActivePortal] = useState<'CUSTOMER' | 'SHOPKEEPER'>('CUSTOMER');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleCustomerLogin = async (overridePhone?: string, overrideName?: string) => {
    setError('');
    const rawPhone = overridePhone || phone;
    const cleanPhone = rawPhone.replace(/\D/g, '');

    if (!cleanPhone || cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setIsLoading(true);

    try {
      await loginWithPhone(
        cleanPhone,
        Role.CUSTOMER,
        overrideName !== undefined ? overrideName : name.trim()
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
              {/* Development Testing Fast-Track (Required per prompt) */}
              <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={16} className="text-[#FF6B00]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#0F2C59]">
                    Development Fast-Test Modes
                  </h3>
                </div>
                <p className="text-[11px] text-gray-600 mb-3 leading-normal">
                  Select a test scenario below to verify both new customer registration and returning customer database lookup:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Test Existing Customer */}
                  <button
                    type="button"
                    onClick={() => handleCustomerLogin('9820123456', 'Rajesh Gupta')}
                    className="p-3 bg-white hover:bg-blue-50 border border-gray-300 hover:border-[#0F2C59] rounded-xl text-left transition shadow-xs group"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-gray-900 mb-1">
                      <span className="flex items-center gap-1 text-[#0F2C59]">
                        <UserCheck size={14} className="text-emerald-600" />
                        <span>Existing Customer</span>
                      </span>
                      <ArrowRight size={13} className="text-gray-400 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="text-[11px] font-semibold text-gray-700">Rajesh Gupta &bull; 9820123456</div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Loads saved Name, Address &amp; Landmark from database
                    </div>
                  </button>

                  {/* Test New Customer */}
                  <button
                    type="button"
                    onClick={() => {
                      // Generate fresh number or use deterministic test new customer
                      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
                      handleCustomerLogin(`989900${randomSuffix}`, '');
                    }}
                    className="p-3 bg-white hover:bg-orange-50 border border-gray-300 hover:border-[#FF6B00] rounded-xl text-left transition shadow-xs group"
                  >
                    <div className="flex items-center justify-between text-xs font-bold text-gray-900 mb-1">
                      <span className="flex items-center gap-1 text-[#FF6B00]">
                        <UserPlus size={14} className="text-[#FF6B00]" />
                        <span>New Customer</span>
                      </span>
                      <ArrowRight size={13} className="text-gray-400 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="text-[11px] font-semibold text-gray-700">Brand New Mobile Number</div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Address &amp; Landmark start 100% blank
                    </div>
                  </button>
                </div>
              </div>

              {/* Standard Direct Mobile Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCustomerLogin();
                }}
                className="space-y-4 pt-1"
              >
                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                    Customer Mobile Number <span className="text-rose-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-100 text-gray-700 font-mono font-bold px-3.5 py-2.5 rounded-xl border border-gray-300 text-sm">
                      +91
                    </span>
                    <div className="relative flex-1">
                      <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="tel"
                        maxLength={10}
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                        placeholder="Enter 10-digit mobile"
                        className="w-full pl-9 pr-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-mono font-bold text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Your 10-digit mobile anchors your single universal customer identity across all browsers.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                    Customer Full Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ramesh Patil (will be retrieved if existing)"
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-800 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0F2C59] focus:border-transparent outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#0F2C59] hover:bg-[#153e7d] text-white font-extrabold py-3 px-5 rounded-xl transition shadow-md flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span>Authenticating...</span>
                    </>
                  ) : (
                    <>
                      <span>Proceed to Customer Profile</span>
                      <ArrowRight size={16} className="text-[#D4AF37]" />
                    </>
                  )}
                </button>
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
                    type="password"
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full pl-9 pr-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-800 focus:ring-2 focus:ring-[#0F2C59] outline-none"
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Owner portal for wholesale fulfillment, live margin controls &amp; catalog management.
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-[#D4AF37] hover:bg-[#b89528] text-[#0F2C59] font-black py-3 px-5 rounded-xl transition shadow-md flex items-center justify-center gap-2"
              >
                <ShieldCheck size={18} />
                <span>Enter Shopkeeper Admin Center</span>
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
    </div>
  );
};
