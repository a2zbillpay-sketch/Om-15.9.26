import React, { useState, useEffect } from 'react';
import { Store, ShoppingBag, ShieldCheck, ArrowLeft, LogIn, Eye, EyeOff } from 'lucide-react';
import { Role } from '../types';
import { useApp } from '../context/AppContext';
import { BrandLogo } from './BrandLogo';

interface EntryLoginPageProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: Role;
}

export const EntryLoginPage: React.FC<EntryLoginPageProps> = ({
  isOpen,
  onClose,
  defaultRole,
}) => {
  const { loginWithPhone } = useApp();
  const [selectedRole, setSelectedRole] = useState<'SHOPKEEPER' | 'CUSTOMER' | null>(
    defaultRole === Role.SHOPKEEPER ? 'SHOPKEEPER' : defaultRole === Role.CUSTOMER ? 'CUSTOMER' : null
  );
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // Always reset fields to blank whenever the modal opens or role changes
  useEffect(() => {
    if (isOpen) {
      setPhone('');
      setPassword('');
      setName('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');

    if (selectedRole === 'SHOPKEEPER') {
      if (!password.trim()) {
        setError('Please enter your admin password');
        return;
      }
      loginWithPhone(
        phone.trim() || '9876543210',
        Role.SHOPKEEPER,
        name.trim() || 'Om Prakash Sharma'
      );
      onClose();
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }

    loginWithPhone(
      cleanPhone,
      Role.CUSTOMER,
      name.trim() || 'Valued Customer'
    );
    onClose();
  };

  const handleSelectRole = (role: 'SHOPKEEPER' | 'CUSTOMER') => {
    setSelectedRole(role);
    setPhone('');
    setPassword('');
    setName('');
    setError('');
  };

  return (
    <div id="auth-modal" className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 border-t-8 border-[#D4AF37] relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 text-lg font-bold w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
          aria-label="Close auth"
        >
          ✕
        </button>

        {/* Brand Header with Official Logo */}
        <div className="text-center mb-5 flex flex-col items-center">
          <BrandLogo size="xl" className="mb-2" />
          <h1 className="text-xl font-extrabold text-[#0F2C59] tracking-wide">OM DISTRIBUTORS</h1>
          <p className="text-xs text-gray-600 font-medium">Multi Service Provider • We meet your needs.</p>
        </div>

        {!selectedRole ? (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-500 text-center uppercase tracking-wider">Select Access Portal</p>

            <button
              id="select-shopkeeper-role-btn"
              onClick={() => handleSelectRole('SHOPKEEPER')}
              className="w-full bg-[#0F2C59] hover:bg-[#153e7d] text-white p-4 rounded-xl font-bold flex items-center justify-between transition-all duration-200 shadow-md border border-[#D4AF37]/40 hover:scale-[1.01]"
            >
              <div className="flex items-center gap-3 text-left">
                <Store className="text-[#D4AF37]" size={24} />
                <div>
                  <div className="text-sm font-extrabold">Om Distributors Login</div>
                  <div className="text-[11px] text-gray-300 font-normal">Shopkeeper & Admin Portal</div>
                </div>
              </div>
              <ShieldCheck className="text-emerald-400" size={20} />
            </button>

            <button
              id="select-customer-role-btn"
              onClick={() => handleSelectRole('CUSTOMER')}
              className="w-full bg-[#FF6B00] hover:bg-[#e05e00] text-white p-4 rounded-xl font-bold flex items-center justify-between transition-all duration-200 shadow-md hover:scale-[1.01]"
            >
              <div className="flex items-center gap-3 text-left">
                <ShoppingBag className="text-white" size={24} />
                <div>
                  <div className="text-sm font-extrabold">Customer Login</div>
                  <div className="text-[11px] text-orange-100 font-normal">Retail & Bulk Orders with Discounts</div>
                </div>
              </div>
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded font-mono">Direct Login</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b pb-2">
              <span className="text-[#0F2C59] font-bold text-sm flex items-center gap-1.5">
                {selectedRole === 'SHOPKEEPER' ? '🏪 Shopkeeper Admin Auth' : '🛒 Customer Account'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedRole(null);
                  setPhone('');
                  setName('');
                  setError('');
                }}
                className="text-xs text-[#0F2C59] hover:underline flex items-center gap-1"
              >
                <ArrowLeft size={12} /> Change Role
              </button>
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 text-xs p-2.5 rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Your Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selectedRole === 'SHOPKEEPER' ? 'Om Prakash Sharma' : 'e.g. Rajesh Gupta'}
                  autoComplete="off"
                  className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0F2C59] outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {selectedRole === 'SHOPKEEPER' ? 'PASSWORD' : 'Mobile Number'}
                </label>
                {selectedRole === 'SHOPKEEPER' ? (
                  <div className="relative">
                    <input
                      id="admin-password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      autoComplete="off"
                      className="w-full p-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0F2C59] outline-none text-sm font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-100 p-2.5 text-sm font-bold text-gray-600 rounded-lg border border-gray-300">
                      +91
                    </span>
                    <input
                      id="whatsapp-phone-input"
                      type="tel"
                      maxLength={10}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Enter 10-digit number"
                      autoComplete="off"
                      className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0F2C59] outline-none text-sm font-mono font-semibold"
                    />
                  </div>
                )}
                <p className="text-[11px] text-gray-500 mt-1">
                  {selectedRole === 'SHOPKEEPER'
                    ? 'Enter your shopkeeper admin password for direct access.'
                    : 'Enter your registered 10-digit mobile number for direct access.'}
                </p>
              </div>

              <button
                id="send-whatsapp-otp-btn"
                type="submit"
                className="w-full bg-[#0F2C59] text-white font-bold py-3 rounded-lg mt-2 shadow-md hover:bg-[#153e7d] transition flex items-center justify-center gap-2"
              >
                <LogIn size={18} className="text-[#D4AF37]" />
                <span>Login</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
