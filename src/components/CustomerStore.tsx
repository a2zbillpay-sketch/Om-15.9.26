import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Truck,
  RotateCcw,
  Percent,
  CheckCircle2,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  AlertCircle,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ProductCard } from './ProductCard';
import { PWAInstallButton } from './PWAInstallButton';
import { BrandLogo } from './BrandLogo';

interface CustomerStoreProps {
  searchQuery: string;
  onOpenCart: () => void;
  onOpenWallet: () => void;
}

export const CustomerStore: React.FC<CustomerStoreProps> = ({
  searchQuery,
  onOpenCart,
  onOpenWallet,
}) => {
  const {
    categories,
    products,
    settings,
    cart,
    checkoutBreakdown,
    editingOrder,
    orders,
    currentUser,
    repeatLastOrder,
    repeatOrderNotice,
    setRepeatOrderNotice,
  } = useApp();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');

  // Customer past orders to detect most recent order
  const customerOrders = useMemo(() => {
    return orders.filter(
      (o) =>
        (currentUser.id && o.userId === currentUser.id) ||
        (currentUser.phone && o.customerPhone === currentUser.phone)
    );
  }, [orders, currentUser.id, currentUser.phone]);

  const lastOrder = useMemo(() => {
    if (customerOrders.length === 0) return null;
    return [...customerOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }, [customerOrders]);

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory =
        selectedCategoryId === 'ALL' || p.categoryId === selectedCategoryId;
      const matchesSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase())) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategoryId, searchQuery]);

  const totalCartCount = cart.reduce((acc, i) => acc + i.quantity, 0);

  return (
    <div className="pb-24">
      {/* Dynamic Promotional Hero Banner */}
      <section className="bg-gradient-to-r from-[#0F2C59] via-[#163a6e] to-[#0F2C59] text-white py-8 px-4 sm:px-6 relative overflow-hidden border-b border-[#D4AF37]/30">
        <div className="max-w-7xl mx-auto relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="max-w-2xl text-center md:text-left space-y-3">
            <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start">
              <BrandLogo size="lg" />
              <div>
                <div className="text-xs text-amber-200 font-semibold tracking-wide uppercase">MULTI SERVICE PROVIDER • We meet your needs.</div>
              </div>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white leading-tight">
              Where Savings Meet <span className="text-[#D4AF37]">Your Kitchen</span>
            </h1>
            <p className="text-xs sm:text-sm text-gray-200 leading-relaxed font-medium">
              We provide home delivery of groceries and essential items only within Nashik city.
            </p>

            {/* Value Highlights */}
            <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs">
              <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
                <Percent size={14} className="text-[#D4AF37]" />
                <span><strong>{settings.advancePaymentDiscountPct}% OFF</strong> on Advance UPI</span>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
                <Truck size={14} className="text-emerald-400" />
                <span>Free Delivery Above <strong>₹{settings.freeShippingMinAmount}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/10">
                <RotateCcw size={14} className="text-amber-400" />
                <span>15-Min Instant Cancellation</span>
              </div>
            </div>
          </div>

          {/* Quick Action PWA / Offer Box */}
          <div className="bg-white/10 backdrop-blur-md p-5 rounded-2xl border border-white/20 text-center max-w-xs shrink-0 shadow-xl">
            <div className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider">Customer Privilege</div>
            <div className="text-lg font-extrabold text-white mt-1">First 3 COD Orders FREE</div>
            <p className="text-[11px] text-gray-200 mt-1 mb-3">
              No extra COD service fee on your first three grocery orders.
            </p>
            <div className="space-y-2">
              <PWAInstallButton variant="prominent" />
              <button
                type="button"
                onClick={onOpenWallet}
                className="w-full text-xs font-black text-[#FFE600] hover:text-yellow-300 underline py-1 tracking-wide transition-colors"
              >
                Earn ₹21 by referring friends →
              </button>
            </div>
          </div>
        </div>

        {/* Decorative Background Elements */}
        <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-[#D4AF37]/10 rounded-full blur-3xl pointer-events-none" />
      </section>

      {/* Repeat Order Notice Banner */}
      {repeatOrderNotice && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div
            id="repeat-order-notice-banner"
            className={`p-3.5 sm:p-4 rounded-2xl border text-xs flex items-start justify-between gap-3 shadow-sm animate-fadeIn ${
              repeatOrderNotice.type === 'warning'
                ? 'bg-amber-50/95 border-amber-300 text-amber-950'
                : repeatOrderNotice.type === 'error'
                ? 'bg-red-50/95 border-red-300 text-red-950'
                : 'bg-emerald-50/95 border-emerald-300 text-emerald-950'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 shadow-xs ${
                  repeatOrderNotice.type === 'warning'
                    ? 'bg-amber-500 text-white'
                    : repeatOrderNotice.type === 'error'
                    ? 'bg-red-500 text-white'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                {repeatOrderNotice.type === 'warning' ? (
                  <AlertTriangle size={15} />
                ) : repeatOrderNotice.type === 'error' ? (
                  <AlertCircle size={15} />
                ) : (
                  <CheckCircle2 size={15} />
                )}
              </div>
              <div className="space-y-1 min-w-0">
                <div className="font-extrabold text-xs sm:text-sm">
                  {repeatOrderNotice.type === 'warning'
                    ? 'Out-of-Stock Items Skipped'
                    : repeatOrderNotice.type === 'error'
                    ? 'Repeat Order Notice'
                    : 'Last Order Loaded to Cart'}
                </div>
                <p className="font-medium text-xs leading-relaxed">{repeatOrderNotice.message}</p>
                {repeatOrderNotice.skippedItems && repeatOrderNotice.skippedItems.length > 0 && (
                  <div className="mt-2 p-2.5 bg-white/90 rounded-xl border border-amber-200">
                    <span className="font-bold text-[11px] text-amber-900 block mb-1">
                      Skipped Out-of-Stock / Unavailable Items:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800 font-medium">
                      {repeatOrderNotice.skippedItems.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {repeatOrderNotice.type !== 'error' && (
                <button
                  type="button"
                  onClick={onOpenCart}
                  className="px-3 py-1.5 bg-[#0F2C59] hover:bg-[#163a6e] text-[#D4AF37] font-extrabold text-xs rounded-xl shadow-xs transition cursor-pointer"
                >
                  View Cart →
                </button>
              )}
              <button
                type="button"
                onClick={() => setRepeatOrderNotice(null)}
                className="p-1 rounded-lg hover:bg-black/5 text-gray-500 hover:text-gray-800 cursor-pointer"
                title="Dismiss notice"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Repeat Last Order Quick Bar (Visible if customer has placed an order) */}
      {lastOrder && (
        <section className="bg-gradient-to-r from-amber-50 via-white to-amber-50/60 border-b border-amber-200/90 px-4 py-2.5 shadow-2xs">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#0F2C59] text-[#D4AF37] flex items-center justify-center shrink-0 shadow-xs">
                <RotateCcw size={15} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-black text-[#0F2C59] flex items-center gap-2 flex-wrap">
                  <span>Repeat Last Order #{lastOrder.orderNumber}</span>
                  <span className="text-[10px] bg-amber-200 text-amber-900 font-bold px-1.5 py-0.2 rounded">
                    {lastOrder.items.length} {lastOrder.items.length === 1 ? 'item' : 'items'}
                  </span>
                  <span className="text-[10px] text-gray-500 font-normal">
                    Placed {new Date(lastOrder.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-[11px] text-gray-600 truncate mt-0.5">
                  1-tap reorder with live wholesale discounts • Out-of-stock items auto-skipped
                </p>
              </div>
            </div>

            <button
              type="button"
              id="btn-repeat-last-order-hero"
              onClick={() => {
                repeatLastOrder();
                onOpenCart();
              }}
              className="w-full sm:w-auto px-4 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-[#D4AF37] hover:text-amber-200 font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 shrink-0 cursor-pointer active:scale-95 border border-[#D4AF37]/40"
              title="Load items from your last order into cart at current prices"
            >
              <RotateCcw size={13} className="text-[#FF6B00]" />
              <span>Repeat Last Order</span>
            </button>
          </div>
        </section>
      )}

      {/* 15 Categories Horizontal Filter Bar */}
      <section className="bg-white border-b border-gray-200 sticky top-[73px] z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-2.5 overflow-x-auto no-scrollbar flex items-center gap-2">
          <button
            onClick={() => setSelectedCategoryId('ALL')}
            className={`px-4 py-2 rounded-xl text-xs font-black shrink-0 transition flex items-center gap-1.5 border ${
              selectedCategoryId === 'ALL'
                ? 'bg-[#0F2C59] text-white border-[#0F2C59] shadow-sm'
                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
            }`}
          >
            <span>All Items</span>
            <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded font-mono">
              {products.length}
            </span>
          </button>

          {categories.map((cat) => {
            const count = products.filter((p) => p.categoryId === cat.id).length;
            const isSelected = selectedCategoryId === cat.id;

            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-[#0F2C59] text-[#D4AF37] border-[#0F2C59] shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {cat.imageUrl && (
                  <img
                    src={cat.imageUrl}
                    alt={cat.name}
                    className="w-4 h-4 rounded-full object-cover shrink-0"
                  />
                )}
                <span>{cat.name}</span>
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Catalog Product Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-black text-[#0F2C59]">
              {selectedCategoryId === 'ALL'
                ? 'All Wholesale & Retail Necessities'
                : categories.find((c) => c.id === selectedCategoryId)?.name}
            </h2>
            <p className="text-xs text-gray-500">
              Showing {filteredProducts.length} verified products • Live mandi rates
            </p>
          </div>

          {searchQuery && (
            <div className="text-xs text-gray-500">
              Search results for "{searchQuery}"
            </div>
          )}
        </div>

        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 max-w-md mx-auto my-8">
            <div className="text-4xl mb-2">🔍</div>
            <h3 className="font-extrabold text-sm text-gray-800">No Grocery Items Found</h3>
            <p className="text-xs text-gray-500 mt-1">
              Try searching for different terms like "Rice", "Atta", "Ghee" or select "All Items".
            </p>
            <button
              onClick={() => setSelectedCategoryId('ALL')}
              className="mt-4 px-4 py-2 bg-[#0F2C59] text-white text-xs font-bold rounded-xl"
            >
              Reset Category Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </main>

      {/* Mobile Floating Sticky Cart Bar */}
      {totalCartCount > 0 && (
        <div className="fixed bottom-3 inset-x-3 sm:hidden z-40">
          <button
            id="mobile-sticky-cart-btn"
            onClick={onOpenCart}
            className="w-full bg-[#0F2C59] text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between border-2 border-[#D4AF37] hover:scale-[1.01] transition"
          >
            <div className="flex items-center gap-2">
              <span className="bg-[#FF6B00] text-white text-xs font-black w-6 h-6 rounded-full flex items-center justify-center">
                {totalCartCount}
              </span>
              <div className="text-left">
                <div className="text-[10px] text-gray-300 uppercase leading-tight font-bold">
                  {editingOrder ? `Editing #${editingOrder.orderNumber}` : 'Cart Total'}
                </div>
                <div className="text-sm font-black text-[#D4AF37] leading-none">
                  ₹{checkoutBreakdown.subtotal}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 text-xs font-black text-white bg-white/10 px-3 py-1.5 rounded-xl">
              <span>{editingOrder ? 'Review & Save' : 'View Cart & Checkout'}</span>
              <ChevronRight size={16} />
            </div>
          </button>
        </div>
      )}
    </div>
  );
};
