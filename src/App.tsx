/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Role, Order } from './types';
import { Navbar } from './components/Navbar';
import { CustomerStore } from './components/CustomerStore';
import { AdminDashboard } from './components/AdminDashboard';
import { CartDrawer } from './components/CartDrawer';
import { CheckoutModal } from './components/CheckoutModal';
import { OrderTrackingModal } from './components/OrderTrackingModal';
import { CustomerOrdersDrawer } from './components/CustomerOrdersDrawer';
import { ReferralWalletModal } from './components/ReferralWalletModal';
import { AddressSelectorModal } from './components/AddressSelectorModal';
import { EntryLoginPage } from './components/EntryLoginPage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { BrandLogo } from './components/BrandLogo';
import { CustomerAuthPage } from './components/CustomerAuthPage';
import { CustomerProfilePage } from './components/CustomerProfilePage';
import { StorePolicyModal, PolicyType } from './components/StorePolicyModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { OrderSuccessModal } from './components/OrderSuccessModal';
import { ShopkeeperLoginNotifier } from './components/ShopkeeperLoginNotifier';
import { EditOrderPaymentModal } from './components/EditOrderPaymentModal';
import { ShieldCheck, Phone, MapPin, Mail, Award, ShoppingBag } from 'lucide-react';

const MainLayout: React.FC = () => {
  const {
    activeRole,
    setActiveRole,
    customerFlowStep,
    setCustomerFlowStep,
    currentUser,
    isAuthModalOpen,
    setIsAuthModalOpen,
    orders,
    settings,
    editingOrder,
    cancelEditingOrder,
    cart,
    isAdminSessionValid,
    checkAdminSession,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isAdminLoginModalOpen, setIsAdminLoginModalOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrdersDrawerOpen, setIsOrdersDrawerOpen] = useState(false);
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [selectedTrackingOrder, setSelectedTrackingOrder] = useState<Order | null>(null);
  const [placedSuccessOrder, setPlacedSuccessOrder] = useState<Order | null>(null);
  const [balancePaymentDetails, setBalancePaymentDetails] = useState<{
    order: Order;
    remainingAmount: number;
    previousPaid: number;
    walletAmountUsed: number;
  } | null>(null);
  const [activePolicy, setActivePolicy] = useState<PolicyType | null>(null);
  const [isGmpQuotaExceeded, setIsGmpQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuota = () => setIsGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  // When an order is opened for editing, open the Store/Product browsing screen
  // with any overlays closed and cart closed so user can browse and adjust products
  useEffect(() => {
    if (editingOrder) {
      setCustomerFlowStep('SHOP');
      setIsOrdersDrawerOpen(false);
      setSelectedTrackingOrder(null);
      setIsCartOpen(false);
    }
  }, [editingOrder, setCustomerFlowStep]);

  const handleShopkeeperClick = async () => {
    const isValid = isAdminSessionValid || (await checkAdminSession());
    if (!isValid) {
      /* ===== TEMPORARY DEV ADMIN LOGIN BYPASS (REMOVE TO RESTORE STRICT DEV PW) ===== */
      if (import.meta.env.DEV) {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ bypassDev: true }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.authenticated) {
            await checkAdminSession();
            setActiveRole(Role.SHOPKEEPER);
            return;
          }
        } catch {
          // fallback to modal
        }
      }
      /* ===== END TEMPORARY DEV ADMIN LOGIN BYPASS ===== */

      setIsAdminLoginModalOpen(true);
      return;
    }
    setActiveRole(Role.SHOPKEEPER);
  };

  const handleOrderSuccess = (orderId: string, createdOrder?: Order) => {
    setIsCheckoutOpen(false);
    setIsCartOpen(false);
    const placedOrder = createdOrder || orders.find((o) => o.id === orderId);
    if (placedOrder) {
      setPlacedSuccessOrder(placedOrder);
    }
  };

  const handleCloseOrderSuccessModal = () => {
    const order = placedSuccessOrder;
    setPlacedSuccessOrder(null);
    if (order) {
      setSelectedTrackingOrder(order);
    }
  };

  const hasCompleteProfile = Boolean(
    currentUser.name &&
    currentUser.addresses &&
    currentUser.addresses.length > 0 &&
    currentUser.addresses[0]?.fullAddress?.trim()
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 font-sans selection:bg-[#D4AF37] selection:text-[#0F2C59]">
      {/* Google Maps Platform Quota Notice */}
      {isGmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Top Navigation */}
      <ShopkeeperLoginNotifier />
      <Navbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenOrders={() => setIsOrdersDrawerOpen(true)}
        onOpenWallet={() => setIsWalletOpen(true)}
        onOpenAddressSelect={() => setIsAddressModalOpen(true)}
        onOpenProfile={() => setCustomerFlowStep('PROFILE')}
      />

      {/* Main View: Orchestrated Customer Flow (Auth -> Profile -> Products/Shop) or Admin */}
      {editingOrder && (
        <div className="bg-[#0F2C59] text-white px-4 py-2.5 text-xs flex items-center justify-between border-b border-[#D4AF37]/40 shadow-md sticky top-[73px] z-20">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="truncate">
              Editing <strong className="text-[#D4AF37]">Order #{editingOrder.orderNumber}</strong>. Browse to add or adjust items, then save changes to this order.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={cancelEditingOrder}
              className="text-gray-300 hover:text-white underline text-xs font-semibold cursor-pointer px-2 py-1"
            >
              Cancel Edit
            </button>
            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="bg-[#FF6B00] hover:bg-[#e05e00] text-white font-extrabold px-3 py-1.5 rounded-lg text-xs cursor-pointer shadow-xs transition flex items-center gap-1.5 active:scale-95"
            >
              <ShoppingBag size={13} />
              <span>Review & Update Order ({cart.reduce((sum, it) => sum + it.quantity, 0)})</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 w-full max-w-full">
        {activeRole === Role.SHOPKEEPER ||
        activeRole === Role.SECONDARY_ADMIN ||
        activeRole === Role.ACCOUNTS ? (
          <div className="w-full max-w-full min-w-0 overflow-x-hidden">
            <AdminDashboard />
          </div>
        ) : customerFlowStep === 'AUTH' ? (
          <CustomerAuthPage onSuccess={() => setCustomerFlowStep('PROFILE')} />
        ) : customerFlowStep === 'PROFILE' ? (
          <CustomerProfilePage
            onProfileSaved={() => setCustomerFlowStep('SHOP')}
            canCancel={hasCompleteProfile}
            onCancel={() => setCustomerFlowStep('SHOP')}
          />
        ) : (
          <CustomerStore
            searchQuery={searchQuery}
            onOpenCart={() => setIsCartOpen(true)}
            onOpenWallet={() => setIsWalletOpen(true)}
          />
        )}
      </div>

      {/* Store Footer */}
      <footer className="bg-[#0b2245] text-white border-t-2 border-[#D4AF37]/40 py-10 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 text-xs">
          <div>
            <div className="flex items-center gap-2.5 mb-2.5">
              <BrandLogo size="xs" />
              <div>
                <h3
                  onClick={handleShopkeeperClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleShopkeeperClick();
                    }
                  }}
                  title="Shopkeeper Login / Portal"
                  className="font-extrabold text-sm text-[#D4AF37] leading-tight cursor-pointer hover:opacity-90 select-none"
                >
                  {settings.appName}
                </h3>
                <span className="text-[10px] text-gray-300">Multi Service Provider</span>
              </div>
            </div>
            <p className="text-gray-300 leading-relaxed text-[11px]">
              Direct wholesale distributor supplying retail kirana stores, catering businesses, and residential societies with premium daily staples, grains, and dry fruits.
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-emerald-400 font-bold text-[10px]">
              <ShieldCheck size={14} />
              <span>FSSAI License: 11521028000492</span>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[#D4AF37] uppercase tracking-wider mb-3">Distributor Benefits</h4>
            <ul className="space-y-1.5 text-gray-300 text-[11px]">
              <li>• Wholesale Volume Slab Discounts</li>
              <li>• Extra {settings.advancePaymentDiscountPct}% Savings on Advance UPI</li>
              <li>• First 3 COD Doorstep Orders Free</li>
              <li>• 15-Minute Cancellation Assurance</li>
              <li>• Laser-Cleaned Desi Pulses & Grains</li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-[#D4AF37] uppercase tracking-wider mb-3">Support & Helpline</h4>
            <div className="space-y-2 text-gray-300 text-[11px]">
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-[#FF6B00]" />
                <span>WhatsApp / Call: +91 98765 43210</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-[#FF6B00]" />
                <span>orders@omdistributors.in</span>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={14} className="text-[#FF6B00] shrink-0 mt-0.5" />
                <span>Shop 14-16, Wholesale Mandi Commercial Hub, APMC Complex</span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-[#D4AF37] uppercase tracking-wider mb-3">PWA Quick Install</h4>
            <p className="text-gray-300 text-[11px] mb-3">
              Install the official Om Distributors mobile web app for instant 1-tap reorders and live dispatch alerts.
            </p>
            <div className="inline-block bg-white/10 px-3 py-2 rounded-xl border border-white/10 text-[10px] text-amber-200">
              ⚡ Progressive Web App Ready • Offline Catalog Enabled
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-8 pt-4 border-t border-white/10 flex flex-col sm:flex-row justify-between items-center text-[10px] text-gray-400 gap-2">
          <span>© {new Date().getFullYear()} Om Distributors. All rights reserved. Registered Wholesale Merchant.</span>
          <div className="flex gap-4">
            <button
              onClick={() => setActivePolicy('TERMS')}
              className="hover:text-amber-300 transition underline underline-offset-2"
            >
              Wholesale Terms
            </button>
            <button
              onClick={() => setActivePolicy('PRIVACY')}
              className="hover:text-amber-300 transition underline underline-offset-2"
            >
              Privacy Policy
            </button>
            <button
              onClick={() => setActivePolicy('REFUND')}
              className="hover:text-amber-300 transition underline underline-offset-2"
            >
              Return & Refund Policy
            </button>
          </div>
        </div>
      </footer>

      {/* Slide-over & Modal Overlays */}
      <StorePolicyModal
        policyType={activePolicy}
        onClose={() => setActivePolicy(null)}
      />
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
        onOrderUpdated={(updated) => {
          setSelectedTrackingOrder(updated);
        }}
        onRedirectToPayment={(details) => {
          setBalancePaymentDetails(details);
        }}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        onOrderSuccess={handleOrderSuccess}
      />

      {/* Immediate Order Placed Confirmation Popup */}
      <OrderSuccessModal
        isOpen={Boolean(placedSuccessOrder)}
        order={placedSuccessOrder}
        onClose={handleCloseOrderSuccessModal}
      />

      {/* Edit Order Balance Payment Modal */}
      <EditOrderPaymentModal
        isOpen={Boolean(balancePaymentDetails)}
        onClose={() => {
          const order = balancePaymentDetails?.order;
          setBalancePaymentDetails(null);
          if (order) {
            setSelectedTrackingOrder(order);
          }
        }}
        order={balancePaymentDetails?.order || null}
        remainingAmountToPay={balancePaymentDetails?.remainingAmount || 0}
        previousOnlinePaid={balancePaymentDetails?.previousPaid || 0}
        walletAmountUsed={balancePaymentDetails?.walletAmountUsed || 0}
        onPaymentSuccess={(updated) => {
          setBalancePaymentDetails(null);
          setPlacedSuccessOrder(updated);
        }}
      />

      <CustomerOrdersDrawer
        isOpen={isOrdersDrawerOpen}
        onClose={() => setIsOrdersDrawerOpen(false)}
        onSelectOrder={(order) => setSelectedTrackingOrder(order)}
        onOpenCart={() => setIsCartOpen(true)}
      />

      <OrderTrackingModal
        isOpen={!!selectedTrackingOrder}
        order={
          selectedTrackingOrder
            ? orders.find((o) => o.id === selectedTrackingOrder.id) || selectedTrackingOrder
            : null
        }
        onClose={() => setSelectedTrackingOrder(null)}
        onOpenCart={() => setIsCartOpen(true)}
        onPayPendingBalance={(orderToPay) => {
          const wUsed = Math.max(0, orderToPay.walletAmountUsed || 0);
          const rem = Math.max(
            0,
            orderToPay.totalPayable !== undefined ? orderToPay.totalPayable : orderToPay.finalAmount
          );
          const prev =
            orderToPay.previousOnlinePaid !== undefined && orderToPay.previousOnlinePaid > 0
              ? orderToPay.previousOnlinePaid
              : Math.max(0, orderToPay.finalAmount - wUsed - rem);
          setBalancePaymentDetails({
            order: orderToPay,
            remainingAmount: rem,
            previousPaid: prev,
            walletAmountUsed: wUsed,
          });
        }}
      />

      <ReferralWalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
      />

      <AddressSelectorModal
        isOpen={isAddressModalOpen}
        onClose={() => setIsAddressModalOpen(false)}
      />

      <EntryLoginPage
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        defaultRole={activeRole}
      />

      <AdminLoginModal
        isOpen={isAdminLoginModalOpen}
        onClose={() => setIsAdminLoginModalOpen(false)}
        onSuccess={() => {
          setIsAdminLoginModalOpen(false);
          setActiveRole(Role.SHOPKEEPER);
        }}
      />

      {/* Offline Service Worker Indicator */}
      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
