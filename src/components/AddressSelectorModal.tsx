import React, { useState } from 'react';
import { X, MapPin, Plus, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface AddressSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddressSelectorModal: React.FC<AddressSelectorModalProps> = ({ isOpen, onClose }) => {
  const { userAddresses, selectedAddressId, setSelectedAddressId, addAddress } = useApp();
  const [isAdding, setIsAdding] = useState(false);
  const [fullAddress, setFullAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [pincode, setPincode] = useState('400705');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullAddress.trim() || !pincode.trim()) return;
    addAddress({ fullAddress, landmark, pincode });
    setIsAdding(false);
    setFullAddress('');
    setLandmark('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 border-t-4 border-[#0F2C59]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-[#FF6B00]" />
            <h3 className="font-extrabold text-sm text-[#0F2C59]">Choose Delivery Location</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {!isAdding ? (
          <div className="space-y-3">
            <div className="space-y-2">
              {userAddresses.map((addr) => (
                <div
                  key={addr.id}
                  onClick={() => {
                    setSelectedAddressId(addr.id);
                    onClose();
                  }}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between ${
                    selectedAddressId === addr.id
                      ? 'border-[#0F2C59] bg-[#0F2C59]/5 ring-2 ring-[#0F2C59]/20 font-bold'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <div>
                    <div className="text-gray-900">{addr.fullAddress}</div>
                    {addr.landmark && <div className="text-[11px] text-gray-500 font-normal">Landmark: {addr.landmark}</div>}
                    <div className="text-[10px] text-gray-400 font-mono">Pincode: {addr.pincode}</div>
                  </div>
                  {selectedAddressId === addr.id && (
                    <Check size={16} className="text-[#0F2C59] shrink-0" />
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={() => setIsAdding(true)}
              className="w-full border-2 border-dashed border-[#0F2C59]/40 text-[#0F2C59] hover:bg-[#0F2C59]/5 font-bold text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <Plus size={14} />
              <span>Add New Delivery Address</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3 text-xs">
            <div>
              <label className="font-bold text-gray-700 block mb-1">Full Address / Flat / Shop #</label>
              <textarea
                required
                rows={2}
                value={fullAddress}
                onChange={(e) => setFullAddress(e.target.value)}
                placeholder="e.g. Shop 12, APMC Market Road"
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
                  placeholder="Near Gate 2"
                  className="w-full p-2 border rounded-lg outline-none"
                />
              </div>
              <div>
                <label className="font-bold text-gray-700 block mb-1">Pincode</label>
                <input
                  required
                  type="text"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder="400705"
                  className="w-full p-2 border rounded-lg outline-none font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-[#0F2C59] text-white font-bold rounded-lg"
              >
                Save & Select
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
