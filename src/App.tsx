/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
import { ShieldCheck, Phone, MapPin, Mail, Award } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { activeRole, isAuthModalOpen, setIsAuthModalOpen, orders, settings } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrdersDrawerOpen, setIsOrdersDrawerOpen] = useState(false);
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [selectedTrackingOrder, setSelectedTrackingOrder] = useState<Order | null>(null);

  const handleOrderSuccess = (orderId: string) => {
    setIsCheckoutOpen(false);
    setIsCartOpen(false);
    const placedOrder = orders.find((o) => o.id === orderId);
    if (placedOrder) {
      setSelectedTrackingOrder(placedOrder);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 font-sans selection:bg-[#D4AF37] selection:text-[#0F2C59]">
      {/* Top Navigation */}
      <Navbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenOrders={() => setIsOrdersDrawerOpen(true)}
        onOpenWallet={() => setIsWalletOpen(true)}
        onOpenAddressSelect={() => setIsAddressModalOpen(true)}
      />

      {/* Main View: Customer Storefront or Admin Dashboard */}
      <div className="flex-1">
        {activeRole === Role.SHOPKEEPER ||
        activeRole === Role.SECONDARY_ADMIN ||
        activeRole === Role.ACCOUNTS ? (
          <AdminDashboard />
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
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded bg-[#D4AF37] text-[#0F2C59] font-black flex items-center justify-center text-xs">
                OM
              </div>
              <h3 className="font-extrabold text-sm text-[#D4AF37]">{settings.appName}</h3>
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
            <span>Wholesale Terms</span>
            <span>Privacy Policy</span>
            <span>Return & Refund Policy</span>
          </div>
        </div>
      </footer>

      {/* Slide-over & Modal Overlays */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        onOrderSuccess={handleOrderSuccess}
      />

      <CustomerOrdersDrawer
        isOpen={isOrdersDrawerOpen}
        onClose={() => setIsOrdersDrawerOpen(false)}
        onSelectOrder={(order) => setSelectedTrackingOrder(order)}
      />

      <OrderTrackingModal
        isOpen={!!selectedTrackingOrder}
        order={selectedTrackingOrder}
        onClose={() => setSelectedTrackingOrder(null)}
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
