import React, { useState, useEffect } from 'react';
import { X, MapPin, Plus, Check, Pencil, Trash2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Address, AddressLabel, formatFullAddress, normalizeAddressLabel } from '../types';
import {
  INDIAN_MOBILE_REGEX,
  INVALID_INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
} from '../lib/supabase';

interface AddressSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ADDRESS_LABELS: readonly AddressLabel[] = ['HOME', 'SHOP', 'OFFICE', 'OTHER'];

export const AddressSelectorModal: React.FC<AddressSelectorModalProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    userAddresses,
    addressesLoading,
    addressesError,
    refreshAddresses,
    selectedAddressId,
    setSelectedAddressId,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
  } = useApp();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [addressLabel, setAddressLabel] = useState<AddressLabel>('HOME');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsFormOpen(false);
      setEditingAddressId(null);
      setConfirmDeleteId(null);
      setFormError(null);
      setActionError(null);
      refreshAddresses();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const resetForm = () => {
    setIsFormOpen(false);
    setEditingAddressId(null);
    setAddressLabel('HOME');
    setRecipientName(currentUser.name || '');
    setRecipientPhone(currentUser.phone || '');
    setAddressLine1('');
    setAddressLine2('');
    setLandmark('');
    setCity('');
    setState('');
    setPincode('');
    setMakeDefault(false);
    setFormError(null);
  };

  const openAddForm = () => {
    setEditingAddressId(null);
    setAddressLabel('HOME');
    setRecipientName(currentUser.name || '');
    setRecipientPhone(currentUser.phone || '');
    setAddressLine1('');
    setAddressLine2('');
    setLandmark('');
    setCity('');
    setState('');
    setPincode('');
    setMakeDefault(userAddresses.length === 0);
    setFormError(null);
    setActionError(null);
    setConfirmDeleteId(null);
    setIsFormOpen(true);
  };

  const openEditForm = (addr: Address) => {
    setEditingAddressId(addr.id);
    setAddressLabel(normalizeAddressLabel(addr.addressLabel ?? addr.label));
    setRecipientName(addr.recipientName || currentUser.name || '');
    setRecipientPhone(addr.recipientPhone || currentUser.phone || '');
    setAddressLine1(addr.addressLine1 || addr.fullAddress || '');
    setAddressLine2(addr.addressLine2 || '');
    setLandmark(addr.landmark || '');
    setCity(addr.city || '');
    setState(addr.state || '');
    setPincode(addr.pincode || '');
    setMakeDefault(Boolean(addr.isDefault));
    setFormError(null);
    setActionError(null);
    setConfirmDeleteId(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanRecipientName = recipientName.trim();
    const cleanRecipientPhone = normalizeIndianMobile(recipientPhone);
    const cleanLine1 = addressLine1.trim();
    const cleanLine2 = addressLine2.trim();
    const cleanLandmark = landmark.trim();
    const cleanCity = city.trim();
    const cleanState = state.trim();
    const cleanPin = pincode.trim();

    if (!cleanRecipientName) {
      setFormError('Recipient name is required.');
      return;
    }
    if (!cleanRecipientPhone || !INDIAN_MOBILE_REGEX.test(cleanRecipientPhone)) {
      setFormError(INVALID_INDIAN_MOBILE_MESSAGE);
      return;
    }
    if (!cleanLine1) {
      setFormError('Please enter Address Line 1 (Flat / Shop / Street).');
      return;
    }
    if (!cleanCity) {
      setFormError('City is required.');
      return;
    }
    if (!cleanState) {
      setFormError('State is required.');
      return;
    }
    if (!cleanPin || !/^\d{6}$/.test(cleanPin)) {
      setFormError('Please enter a valid 6-digit pincode.');
      return;
    }

    const derivedFullAddress = formatFullAddress({
      addressLine1: cleanLine1,
      addressLine2: cleanLine2,
      landmark: cleanLandmark,
      city: cleanCity,
      state: cleanState,
      pincode: cleanPin,
    });

    setIsSubmitting(true);
    try {
      if (editingAddressId) {
        const res = await updateAddress(editingAddressId, {
          addressLabel,
          label: addressLabel,
          recipientName: cleanRecipientName,
          recipientPhone: cleanRecipientPhone,
          addressLine1: cleanLine1,
          addressLine2: cleanLine2,
          fullAddress: derivedFullAddress,
          landmark: cleanLandmark,
          city: cleanCity,
          state: cleanState,
          pincode: cleanPin,
          isDefault: makeDefault,
        });
        if (!res.success) {
          setFormError(res.error || 'Failed to update delivery address.');
          return;
        }
      } else {
        const res = await addAddress({
          addressLabel,
          label: addressLabel,
          recipientName: cleanRecipientName,
          recipientPhone: cleanRecipientPhone,
          addressLine1: cleanLine1,
          addressLine2: cleanLine2,
          fullAddress: derivedFullAddress,
          landmark: cleanLandmark,
          city: cleanCity,
          state: cleanState,
          pincode: cleanPin,
          isDefault: makeDefault || userAddresses.length === 0,
        });
        if (!res.success) {
          setFormError(res.error || 'Failed to save delivery address.');
          return;
        }
      }
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetDefault = async (addressId: string) => {
    setActionError(null);
    setBusyId(addressId);
    try {
      const res = await setDefaultAddress(addressId);
      if (!res.success) {
        setActionError(res.error || 'Unable to set default address.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (addressId: string) => {
    setActionError(null);
    setBusyId(addressId);
    try {
      const res = await deleteAddress(addressId);
      if (!res.success) {
        setActionError(res.error || 'Unable to delete address.');
      } else {
        setConfirmDeleteId(null);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 border-t-4 border-[#0F2C59] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-[#FF6B00]" />
            <h3 className="font-extrabold text-sm text-[#0F2C59]">
              {isFormOpen
                ? editingAddressId
                  ? 'Edit Delivery Address'
                  : 'Add Delivery Address'
                : 'Choose Delivery Location'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {!isFormOpen ? (
          <div className="space-y-3">
            {(addressesError || actionError) && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{actionError || addressesError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => refreshAddresses()}
                  className="text-[11px] font-bold underline shrink-0 flex items-center gap-1"
                >
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            )}

            {addressesLoading && userAddresses.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-gray-500 text-xs gap-2">
                <Loader2 size={20} className="animate-spin text-[#0F2C59]" />
                <span>Loading saved delivery addresses...</span>
              </div>
            ) : userAddresses.length === 0 ? (
              <div className="py-6 px-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-center text-xs text-gray-500 space-y-1">
                <p className="font-bold text-gray-700">No delivery addresses saved yet</p>
                <p>Add your home, shop, office, or other delivery location to continue.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {userAddresses.map((addr) => {
                  const isBusy = busyId === addr.id;
                  const isDeletingConfirm = confirmDeleteId === addr.id;
                  const displayLabel = normalizeAddressLabel(addr.addressLabel ?? addr.label);
                  const displayFullAddress = addr.fullAddress || formatFullAddress(addr);
                  return (
                    <div
                      key={addr.id}
                      onClick={() => {
                        if (!isDeletingConfirm && !isBusy) {
                          setSelectedAddressId(addr.id);
                          onClose();
                        }
                      }}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition ${
                        selectedAddressId === addr.id
                          ? 'border-[#0F2C59] bg-[#0F2C59]/5 ring-2 ring-[#0F2C59]/20'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#0F2C59]/10 text-[#0F2C59]">
                              {displayLabel}
                            </span>
                            {addr.isDefault && (
                              <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Default
                              </span>
                            )}
                          </div>
                          {(addr.recipientName || addr.recipientPhone) && (
                            <div className="text-[11px] font-semibold text-gray-700 mb-0.5">
                              {addr.recipientName}
                              {addr.recipientPhone ? ` • +91 ${addr.recipientPhone}` : ''}
                            </div>
                          )}
                          <div className="font-bold text-gray-900 break-words">{displayFullAddress}</div>
                          {addr.landmark && (
                            <div className="text-[11px] text-gray-500 font-normal mt-0.5">
                              Landmark: {addr.landmark}
                            </div>
                          )}
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                            {addr.pincode ? `Pincode: ${addr.pincode}` : 'Pincode: Not provided'}
                          </div>
                        </div>
                        {selectedAddressId === addr.id && (
                          <Check size={16} className="text-[#0F2C59] shrink-0 mt-0.5" />
                        )}
                      </div>

                      <div
                        className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-3">
                          {!addr.isDefault && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleSetDefault(addr.id)}
                              className="text-[10px] font-bold text-[#0F2C59] hover:text-[#FF6B00] underline cursor-pointer disabled:opacity-50"
                            >
                              {isBusy ? 'Updating...' : 'Set as Default'}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => openEditForm(addr)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-600 hover:text-[#0F2C59] px-1.5 py-0.5 rounded hover:bg-gray-100"
                          >
                            <Pencil size={11} /> Edit
                          </button>
                          {isDeletingConfirm ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleDelete(addr.id)}
                                className="text-[10px] font-bold bg-rose-600 text-white px-2 py-0.5 rounded hover:bg-rose-700 disabled:opacity-50"
                              >
                                {isBusy ? 'Deleting...' : 'Confirm'}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-[10px] font-semibold text-gray-500 hover:text-gray-800 px-1"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmDeleteId(addr.id)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-800 px-1.5 py-0.5 rounded hover:bg-rose-50"
                            >
                              <Trash2 size={11} /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={openAddForm}
              className="w-full border-2 border-dashed border-[#0F2C59]/40 text-[#0F2C59] hover:bg-[#0F2C59]/5 font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <Plus size={14} />
              <span>Add New Delivery Address</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3 text-xs">
            {formError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1.5">
                <AlertCircle size={14} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="font-bold text-gray-700 block mb-1">Address Label</label>
              <div className="flex flex-wrap items-center gap-2">
                {ADDRESS_LABELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAddressLabel(option)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
                      addressLabel === option
                        ? 'bg-[#0F2C59] text-white border-[#0F2C59]'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-bold text-gray-700 block mb-1">
                  Recipient Name <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Recipient full name"
                  className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-[#0F2C59]"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">
                  Recipient Phone <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  maxLength={10}
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="10-digit mobile"
                  className="w-full p-2 border rounded-lg outline-none font-mono focus:ring-2 focus:ring-[#0F2C59]"
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">
                Address Line 1 (House / Shop / Street) <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="e.g. Shop 12, APMC Market Road"
                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-[#0F2C59]"
              />
            </div>

            <div>
              <label className="font-bold text-gray-700 block mb-1">Address Line 2 (Area / Locality)</label>
              <input
                type="text"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                placeholder="Colony, building, floor (optional)"
                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-[#0F2C59]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-bold text-gray-700 block mb-1">Landmark</label>
                <input
                  type="text"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="Near Gate 2 (optional)"
                  className="w-full p-2 border rounded-lg outline-none"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">
                  Pincode <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                  placeholder="6-digit pincode"
                  className="w-full p-2 border rounded-lg outline-none font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-bold text-gray-700 block mb-1">
                  City <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Enter city"
                  className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-[#0F2C59]"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">
                  State <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="Enter state"
                  className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-[#0F2C59]"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-[#0F2C59]"
              />
              <span>Set as default delivery address</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={resetForm}
                className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 bg-[#0F2C59] text-white font-bold rounded-lg disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : editingAddressId ? 'Update Address' : 'Save & Select'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
