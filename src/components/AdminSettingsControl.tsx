import React, { useState } from 'react';
import { Save, Check, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { INITIAL_SETTINGS } from '../data/seedData';

export const AdminSettingsControl: React.FC = () => {
  const { settings, updateSettings } = useApp();
  const [formData, setFormData] = useState({
    appName: settings.appName,
    primaryColorHex: settings.primaryColorHex,
    secondaryColorHex: settings.secondaryColorHex,
    accentColorHex: settings.accentColorHex,
    advancePaymentDiscountPct: settings.advancePaymentDiscountPct,
    codBaseCharge: settings.codBaseCharge,
    freeShippingMinAmount: settings.freeShippingMinAmount,
    referralRewardAmount: settings.referralRewardAmount,
    baseDeliveryFee: settings.baseDeliveryFee,
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = () => {
    updateSettings(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleResetDefaults = () => {
    setFormData({
      appName: INITIAL_SETTINGS.appName,
      primaryColorHex: INITIAL_SETTINGS.primaryColorHex,
      secondaryColorHex: INITIAL_SETTINGS.secondaryColorHex,
      accentColorHex: INITIAL_SETTINGS.accentColorHex,
      advancePaymentDiscountPct: INITIAL_SETTINGS.advancePaymentDiscountPct,
      codBaseCharge: INITIAL_SETTINGS.codBaseCharge,
      freeShippingMinAmount: INITIAL_SETTINGS.freeShippingMinAmount,
      referralRewardAmount: INITIAL_SETTINGS.referralRewardAmount,
      baseDeliveryFee: INITIAL_SETTINGS.baseDeliveryFee,
    });
    updateSettings(INITIAL_SETTINGS);
  };

  return (
    <div id="admin-settings-container" className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-md border border-gray-100">
      <div className="flex flex-wrap justify-between items-center pb-4 mb-6 border-b gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#0F2C59]">Shopkeeper Store Settings</h1>
          <p className="text-xs text-gray-500">
            Manage store branding, dynamic discount rates, delivery fees, and referral engine
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetDefaults}
            className="text-xs text-gray-600 hover:text-gray-900 border border-gray-300 px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 hover:bg-gray-50"
          >
            <RotateCcw size={14} />
            <span>Reset Defaults</span>
          </button>
          <button
            id="save-settings-btn"
            onClick={handleSave}
            className="bg-[#0F2C59] text-[#D4AF37] px-5 py-2 rounded-lg font-bold text-xs flex items-center gap-2 hover:bg-[#153e7d] shadow-sm transition"
          >
            {savedSuccess ? <Check size={16} className="text-emerald-400" /> : <Save size={16} />}
            <span>{savedSuccess ? 'Changes Applied!' : 'Save Changes'}</span>
          </button>
        </div>
      </div>

      {savedSuccess && (
        <div className="mb-6 p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-xs font-semibold flex items-center gap-2">
          <Check size={16} className="text-emerald-600" />
          <span>Settings successfully updated across store & checkout engine!</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Visual Customization */}
        <div className="space-y-4 bg-gray-50 p-5 rounded-xl border border-gray-200">
          <h2 className="text-xs font-bold text-[#0F2C59] uppercase tracking-wider">Branding & Themes</h2>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Store Name</label>
            <input
              type="text"
              value={formData.appName}
              onChange={(e) => setFormData({ ...formData, appName: e.target.value })}
              className="w-full p-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-[#0F2C59] outline-none font-medium"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-700 block mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.primaryColorHex}
                  onChange={(e) => setFormData({ ...formData, primaryColorHex: e.target.value })}
                  className="w-8 h-8 rounded border cursor-pointer shrink-0"
                />
                <span className="text-[10px] font-mono text-gray-600">{formData.primaryColorHex}</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-700 block mb-1">Secondary (Gold)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.secondaryColorHex}
                  onChange={(e) => setFormData({ ...formData, secondaryColorHex: e.target.value })}
                  className="w-8 h-8 rounded border cursor-pointer shrink-0"
                />
                <span className="text-[10px] font-mono text-gray-600">{formData.secondaryColorHex}</span>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-700 block mb-1">Accent (Saffron)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.accentColorHex}
                  onChange={(e) => setFormData({ ...formData, accentColorHex: e.target.value })}
                  className="w-8 h-8 rounded border cursor-pointer shrink-0"
                />
                <span className="text-[10px] font-mono text-gray-600">{formData.accentColorHex}</span>
              </div>
            </div>
          </div>

          {/* Theme preview swatch */}
          <div className="p-3 rounded-lg border border-gray-200 mt-2" style={{ backgroundColor: formData.primaryColorHex }}>
            <div className="flex items-center justify-between text-white">
              <span className="font-extrabold text-sm" style={{ color: formData.secondaryColorHex }}>
                {formData.appName}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ backgroundColor: formData.accentColorHex }}>
                Preview Badge
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Financial Engine Configuration */}
        <div className="space-y-4 bg-gray-50 p-5 rounded-xl border border-gray-200">
          <h2 className="text-xs font-bold text-[#0F2C59] uppercase tracking-wider">Checkout Pricing Engine</h2>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">
              Advance Payment Discount (%)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="25"
              value={formData.advancePaymentDiscountPct}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  advancePaymentDiscountPct: parseFloat(e.target.value) || 0,
                })
              }
              className="w-full p-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-[#0F2C59] outline-none"
            />
            <span className="text-[10px] text-gray-500 mt-0.5 block">
              Applied automatically to non-excluded grocery items when paying via UPI/Online.
            </span>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">COD Base Extra Charge (₹)</label>
            <input
              type="number"
              min="0"
              value={formData.codBaseCharge}
              onChange={(e) =>
                setFormData({ ...formData, codBaseCharge: parseFloat(e.target.value) || 0 })
              }
              className="w-full p-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-[#0F2C59] outline-none"
            />
            <span className="text-[10px] text-gray-500 mt-0.5 block">
              First 3 COD orders are always free for any customer.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                Free Delivery Above (₹)
              </label>
              <input
                type="number"
                min="0"
                value={formData.freeShippingMinAmount}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    freeShippingMinAmount: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full p-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-[#0F2C59] outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                Standard Delivery Fee (₹)
              </label>
              <input
                type="number"
                min="0"
                value={formData.baseDeliveryFee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    baseDeliveryFee: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full p-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-[#0F2C59] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Referral Reward Credit (₹)</label>
            <input
              type="number"
              min="0"
              value={formData.referralRewardAmount}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  referralRewardAmount: parseFloat(e.target.value) || 0,
                })
              }
              className="w-full p-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-[#0F2C59] outline-none"
            />
            <span className="text-[10px] text-gray-500 mt-0.5 block">
              Credited directly to customer wallet upon referred friend’s first completed order.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
