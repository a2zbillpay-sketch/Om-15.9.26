import React, { useState } from 'react';
import {
  ShoppingBag,
  MapPin,
  Wallet,
  Clock,
  ShieldCheck,
  Search,
  User as UserIcon,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import { BrandLogo } from './BrandLogo';
import { LogoUploadModal } from './LogoUploadModal';

interface NavbarProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenCart: () => void;
  onOpenOrders: () => void;
  onOpenWallet: () => void;
  onOpenAddressSelect: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  searchQuery,
  setSearchQuery,
  onOpenCart,
  onOpenOrders,
  onOpenWallet,
  onOpenAddressSelect,
}) => {
  const {
    currentUser,
    activeRole,
    cart,
    checkoutBreakdown,
    settings,
    orders,
    setIsAuthModalOpen,
    isAuthModalOpen,
  } = useApp();

  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const isShopkeeper = activeRole !== Role.CUSTOMER;

  const totalCartCount = cart.reduce((acc, i) => acc + i.quantity, 0);

  const activeOrdersCount = orders.filter(
    (o) => o.userId === currentUser.id && o.status !== 'DELIVERED' && o.status !== 'CANCELLED'
  ).length;

  const currentAddress = currentUser.addresses.find((a) => a.isDefault) || currentUser.addresses[0];

  return (
    <header className="sticky top-0 z-40 bg-[#0F2C59] text-white shadow-lg border-b border-[#D4AF37]/30">
      {/* Top Announcements & Role Bar */}
      <div className="bg-[#0b2245] px-4 py-1.5 text-[11px] border-b border-white/10 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto text-gray-200">
          <span className="bg-[#FF6B00] text-white font-extrabold px-2 py-0.2 rounded text-[10px] uppercase">
            WHOLESALE & RETAIL
          </span>
          <span className="hidden sm:inline">
            Direct Distributor Rates | Extra {settings.advancePaymentDiscountPct}% OFF on Advance UPI Payment
          </span>
          <span className="sm:hidden">
            Extra {settings.advancePaymentDiscountPct}% OFF on Online UPI
          </span>
        </div>

        <div className="text-[10px] text-gray-300 font-medium hidden md:flex items-center gap-1.5 shrink-0">
          <span className="text-[#D4AF37]">★</span>
          <span>Direct Wholesale & Retail Supplies</span>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Brand Logo */}
        <div
          onClick={() => isShopkeeper && setIsLogoModalOpen(true)}
          className={`flex items-center gap-3 shrink-0 ${isShopkeeper ? 'cursor-pointer group' : ''}`}
          title={isShopkeeper ? 'Click to upload or change store logo as-is' : undefined}
        >
          <div className="relative">
            <BrandLogo size="md" />
            {isShopkeeper && (
              <span className="absolute -bottom-1 -right-1 bg-[#D4AF37] text-[#0F2C59] p-0.5 rounded-full shadow border border-white opacity-80 group-hover:opacity-100 transition-opacity">
                <Upload size={10} />
              </span>
            )}
          </div>
          <div className="hidden sm:block">
            <div className="font-black text-base tracking-wide text-[#D4AF37] flex items-center gap-1.5 leading-none">
              {settings.appName.toUpperCase()}
            </div>
            <p className="text-[10px] text-gray-300 font-medium tracking-tight mt-0.5">
              Wholesale & Retail Necessities
            </p>
          </div>
        </div>

        {/* Deliver To Location Selector (For Customer) */}
        {activeRole === Role.CUSTOMER && (
          <button
            id="deliver-to-address-btn"
            onClick={onOpenAddressSelect}
            className="hidden lg:flex items-center gap-1.5 bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-lg text-left text-xs transition border border-white/10 shrink-0 max-w-[200px]"
          >
            <MapPin size={14} className="text-[#FF6B00] shrink-0" />
            <div className="truncate">
              <div className="text-[10px] text-gray-300">Deliver to:</div>
              <div className="font-bold truncate text-white">
                {currentAddress?.landmark || currentAddress?.pincode || 'Select Address'}
              </div>
            </div>
          </button>
        )}

        {/* Search Bar - Displayed on customer store, removed from login/admin portal */}
        {activeRole === Role.CUSTOMER && !isAuthModalOpen && (
          <div className="flex-1 max-w-xl relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              id="product-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Basmati Rice, Toor Dal, Atta, Cooking Oil, Spices..."
              className="w-full pl-9 pr-4 py-2 bg-white text-gray-900 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-[#D4AF37] shadow-inner placeholder:text-gray-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Customer Specific Controls */}
          {activeRole === Role.CUSTOMER ? (
            <>
              {/* Wallet Pill */}
              <button
                id="open-wallet-btn"
                onClick={onOpenWallet}
                className="flex items-center gap-1.5 bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-300 px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm"
                title="Your Wallet Balance & Referrals"
              >
                <Wallet size={14} className="text-emerald-400" />
                <span>₹{currentUser.walletBalance}</span>
              </button>

              {/* My Orders Button */}
              <button
                id="open-my-orders-btn"
                onClick={onOpenOrders}
                className="relative flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition border border-white/10"
                title="View Past & Active Orders"
              >
                <Clock size={14} className="text-[#D4AF37]" />
                <span className="hidden md:inline">Orders</span>
                {activeOrdersCount > 0 && (
                  <span className="bg-[#FF6B00] text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-black">
                    {activeOrdersCount}
                  </span>
                )}
              </button>

              {/* Shopping Cart Button */}
              <button
                id="open-cart-btn"
                onClick={onOpenCart}
                className="relative flex items-center gap-2 bg-[#FF6B00] hover:bg-[#e05e00] text-white px-3.5 py-1.5 rounded-xl font-extrabold text-xs shadow-md transition hover:scale-105"
              >
                <ShoppingBag size={16} />
                <div className="hidden sm:block text-left">
                  <div className="text-[10px] leading-tight text-white/90">
                    {totalCartCount} {totalCartCount === 1 ? 'item' : 'items'}
                  </div>
                  <div className="leading-none text-white font-black">
                    ₹{checkoutBreakdown.subtotal}
                  </div>
                </div>
                {totalCartCount > 0 && (
                  <span className="sm:hidden bg-white text-[#FF6B00] text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-black">
                    {totalCartCount}
                  </span>
                )}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="bg-emerald-600/90 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1">
                <ShieldCheck size={12} />
                <span>Admin Verified</span>
              </span>
            </div>
          )}

          {/* User Profile / Auth Modal */}
          <button
            id="open-auth-modal-btn"
            onClick={() => setIsAuthModalOpen(true)}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 p-2 rounded-lg text-xs transition border border-white/10"
            title="Switch Account or Login"
          >
            <UserIcon size={16} className="text-[#D4AF37]" />
          </button>
        </div>
      </div>

      <LogoUploadModal
        isOpen={isLogoModalOpen}
        onClose={() => setIsLogoModalOpen(false)}
      />
    </header>
  );
};
