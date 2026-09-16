import React, { useState, useRef } from 'react';
import { Save, Check, RotateCcw, Upload, Image as ImageIcon, Edit3, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { INITIAL_SETTINGS } from '../data/seedData';
import { BrandLogo } from './BrandLogo';
import { LogoUploadModal } from './LogoUploadModal';

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
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const [isEditingPricing, setIsEditingPricing] = useState(false);
  const [pricingSavedSuccess, setPricingSavedSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSavePricingEngine = () => {
    updateSettings({
      advancePaymentDiscountPct: formData.advancePaymentDiscountPct,
      codBaseCharge: formData.codBaseCharge,
      freeShippingMinAmount: formData.freeShippingMinAmount,
      baseDeliveryFee: formData.baseDeliveryFee,
      referralRewardAmount: formData.referralRewardAmount,
    });
    setPricingSavedSuccess(true);
    setTimeout(() => {
      setPricingSavedSuccess(false);
      setIsEditingPricing(false);
    }, 600);
  };

  const handleCancelPricingEdit = () => {
    setFormData((prev) => ({
      ...prev,
      advancePaymentDiscountPct: settings.advancePaymentDiscountPct,
      codBaseCharge: settings.codBaseCharge,
      freeShippingMinAmount: settings.freeShippingMinAmount,
      baseDeliveryFee: settings.baseDeliveryFee,
      referralRewardAmount: settings.referralRewardAmount,
    }));
    setIsEditingPricing(false);
  };

  const handleDirectFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          updateSettings({ logoUrl: dataUrl });
          setSavedSuccess(true);
          setTimeout(() => setSavedSuccess(false), 3000);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleResetLogo = () => {
    updateSettings({ logoUrl: '' });
  };

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
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-[#0F2C59] uppercase tracking-wider">Branding & Logo</h2>
            <button
              type="button"
              onClick={() => setIsLogoModalOpen(true)}
              className="text-xs font-bold text-[#0F2C59] hover:text-[#163a6e] inline-flex items-center gap-1 hover:underline"
            >
              <Upload size={12} />
              <span>Full Uploader</span>
            </button>
          </div>

          {/* Logo preview & Direct Upload Card */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-3">
            <div className="flex items-center gap-3.5">
              <BrandLogo size="lg" />
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-xs text-gray-900 truncate">
                  Official Om Distributors Logo (Original File)
                </div>
                <div className="text-[11px] text-gray-500">
                  SAVE_20260828_130926.jpg • Displayed as-is without alterations
                </div>
                <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  ✓ Official Image Logo Active
                </span>
              </div>
            </div>

            {/* Direct Upload / Choose file action */}
            <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
                onChange={handleDirectFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F2C59] hover:bg-[#163a6e] text-white rounded-lg text-xs font-bold transition shadow-sm"
              >
                <Upload size={13} className="text-[#D4AF37]" />
                <span>Upload Logo As-Is</span>
              </button>

              <button
                type="button"
                onClick={() => setIsLogoModalOpen(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition"
              >
                <ImageIcon size={13} />
                <span>Drag & Drop / Link</span>
              </button>

              {settings.logoUrl && (
                <button
                  type="button"
                  onClick={handleResetLogo}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg font-medium transition ml-auto"
                >
                  <RotateCcw size={12} />
                  <span>Reset</span>
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400">
              Upload your original image file (e.g. <span className="font-mono text-gray-600 font-semibold">SAVE_20260828_130926.jpg</span>) without any alteration.
            </p>
          </div>

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
              <div className="flex items-center gap-2">
                <BrandLogo size="xs" />
                <span className="font-extrabold text-sm" style={{ color: formData.secondaryColorHex }}>
                  {formData.appName}
                </span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ backgroundColor: formData.accentColorHex }}>
                Preview Badge
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Financial Engine Configuration */}
        <div className="space-y-4 bg-gray-50 p-5 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-[#0F2C59] uppercase tracking-wider">Checkout Pricing Engine</h2>
              {!isEditingPricing ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                  <Lock size={10} />
                  <span>Saved</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 animate-pulse">
                  <span>Editing</span>
                </span>
              )}
            </div>

            {isEditingPricing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelPricingEdit}
                  className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 font-medium rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="save-pricing-engine-btn"
                  onClick={handleSavePricingEngine}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0F2C59] hover:bg-[#153e7d] text-[#D4AF37] font-bold text-xs rounded-lg shadow-sm transition"
                >
                  {pricingSavedSuccess ? <Check size={14} className="text-emerald-400" /> : <Save size={14} />}
                  <span>{pricingSavedSuccess ? 'Saved!' : 'Save'}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                id="edit-pricing-engine-btn"
                onClick={() => setIsEditingPricing(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-gray-100 text-[#0F2C59] border border-gray-300 font-bold text-xs rounded-lg shadow-sm transition hover:border-gray-400"
              >
                <Edit3 size={13} className="text-[#0F2C59]" />
                <span>Edit</span>
              </button>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">
              Advance Payment Discount (%)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="25"
              disabled={!isEditingPricing}
              value={formData.advancePaymentDiscountPct}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  advancePaymentDiscountPct: parseFloat(e.target.value) || 0,
                })
              }
              className={`w-full p-2.5 text-xs border rounded-lg transition ${
                !isEditingPricing
                  ? 'bg-gray-100/80 text-gray-700 border-gray-200 cursor-not-allowed select-none'
                  : 'bg-white text-gray-900 border-gray-300 focus:ring-2 focus:ring-[#0F2C59] outline-none shadow-sm'
              }`}
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
              disabled={!isEditingPricing}
              value={formData.codBaseCharge}
              onChange={(e) =>
                setFormData({ ...formData, codBaseCharge: parseFloat(e.target.value) || 0 })
              }
              className={`w-full p-2.5 text-xs border rounded-lg transition ${
                !isEditingPricing
                  ? 'bg-gray-100/80 text-gray-700 border-gray-200 cursor-not-allowed select-none'
                  : 'bg-white text-gray-900 border-gray-300 focus:ring-2 focus:ring-[#0F2C59] outline-none shadow-sm'
              }`}
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
                disabled={!isEditingPricing}
                value={formData.freeShippingMinAmount}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    freeShippingMinAmount: parseFloat(e.target.value) || 0,
                  })
                }
                className={`w-full p-2.5 text-xs border rounded-lg transition ${
                  !isEditingPricing
                    ? 'bg-gray-100/80 text-gray-700 border-gray-200 cursor-not-allowed select-none'
                    : 'bg-white text-gray-900 border-gray-300 focus:ring-2 focus:ring-[#0F2C59] outline-none shadow-sm'
                }`}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                Standard Delivery Fee (₹)
              </label>
              <input
                type="number"
                min="0"
                disabled={!isEditingPricing}
                value={formData.baseDeliveryFee}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    baseDeliveryFee: parseFloat(e.target.value) || 0,
                  })
                }
                className={`w-full p-2.5 text-xs border rounded-lg transition ${
                  !isEditingPricing
                    ? 'bg-gray-100/80 text-gray-700 border-gray-200 cursor-not-allowed select-none'
                    : 'bg-white text-gray-900 border-gray-300 focus:ring-2 focus:ring-[#0F2C59] outline-none shadow-sm'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Referral Reward Credit (₹)</label>
            <input
              type="number"
              min="0"
              disabled={!isEditingPricing}
              value={formData.referralRewardAmount}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  referralRewardAmount: parseFloat(e.target.value) || 0,
                })
              }
              className={`w-full p-2.5 text-xs border rounded-lg transition ${
                !isEditingPricing
                  ? 'bg-gray-100/80 text-gray-700 border-gray-200 cursor-not-allowed select-none'
                  : 'bg-white text-gray-900 border-gray-300 focus:ring-2 focus:ring-[#0F2C59] outline-none shadow-sm'
              }`}
            />
            <span className="text-[10px] text-gray-500 mt-0.5 block">
              Credited directly to customer wallet upon referred friend’s first completed order.
            </span>
          </div>

          {isEditingPricing && (
            <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-[11px] text-gray-500 font-medium">Click Save to persist changes to the engine</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelPricingEdit}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePricingEngine}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0F2C59] hover:bg-[#153e7d] text-[#D4AF37] font-bold text-xs rounded-lg shadow-sm transition"
                >
                  {pricingSavedSuccess ? <Check size={14} className="text-emerald-400" /> : <Save size={14} />}
                  <span>{pricingSavedSuccess ? 'Saved!' : 'Save Pricing'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <LogoUploadModal
        isOpen={isLogoModalOpen}
        onClose={() => setIsLogoModalOpen(false)}
      />
    </div>
  );
};
