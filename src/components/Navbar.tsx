import React from 'react';
import {
  ShoppingBag,
  Store,
  MapPin,
  Wallet,
  Clock,
  ShieldCheck,
  Search,
  User as UserIcon,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

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
    setActiveRole,
    cart,
    checkoutBreakdown,
    settings,
    orders,
    setIsAuthModalOpen,
  } = useApp();

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

        {/* Portal Role Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-gray-300 text-[10px] hidden md:inline">Current View:</span>
          <div className="inline-flex bg-black/40 p-0.5 rounded-lg border border-[#D4AF37]/40">
            <button
              id="switch-to-customer-mode-btn"
              onClick={() => setActiveRole(Role.CUSTOMER)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition ${
                activeRole === Role.CUSTOMER
                  ? 'bg-[#FF6B00] text-white shadow-sm'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <ShoppingBag size={12} />
              <span>Customer Store</span>
            </button>

            <button
              id="switch-to-shopkeeper-mode-btn"
              onClick={() => setActiveRole(Role.SHOPKEEPER)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition ${
                activeRole === Role.SHOPKEEPER ||
                activeRole === Role.SECONDARY_ADMIN ||
                activeRole === Role.ACCOUNTS
                  ? 'bg-[#D4AF37] text-[#0F2C59] shadow-sm'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              <Store size={12} />
              <span>Shopkeeper Admin</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Brand Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#0F2C59] border-2 border-[#D4AF37] flex items-center justify-center shadow-md">
            <span className="text-[#D4AF37] font-black text-sm tracking-wider">OM</span>
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

        {/* Search Bar */}
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
    </header>
  );
};
