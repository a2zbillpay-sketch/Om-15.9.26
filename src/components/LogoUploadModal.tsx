import React, { useState, useRef, ChangeEvent, DragEvent } from 'react';
import { Upload, X, Check, Image as ImageIcon, RotateCcw, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface LogoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LogoUploadModal: React.FC<LogoUploadModalProps> = ({ isOpen, onClose }) => {
  const { settings, updateSettings } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string>(settings.logoUrl || '');
  const [fileDetails, setFileDetails] = useState<{ name: string; size: string } | null>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [activeMode, setActiveMode] = useState<'FILE' | 'URL'>('FILE');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleProcessFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatusMessage('Please select a valid image file (.jpg, .jpeg, .png, .webp, .svg)');
      return;
    }

    const sizeKb = (file.size / 1024).toFixed(1);
    setFileDetails({
      name: file.name,
      size: `${sizeKb} KB`,
    });

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setPreviewUrl(dataUrl);
        setStatusMessage(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessFile(files[0]);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleProcessFile(files[0]);
    }
  };

  const handleSaveLogo = () => {
    const finalLogo = activeMode === 'URL' && urlInput.trim() ? urlInput.trim() : previewUrl;
    updateSettings({
      logoUrl: finalLogo,
    });
    setStatusMessage('Logo saved as-is and applied across all store pages!');
    setTimeout(() => {
      onClose();
    }, 900);
  };

  const handleResetToDefault = () => {
    setPreviewUrl('');
    setUrlInput('');
    setFileDetails(null);
    updateSettings({
      logoUrl: '',
    });
    setStatusMessage('Reset to clean official Om Distributors default badge.');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
      id="logo-upload-modal"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-gray-200">
        {/* Modal Header */}
        <div className="bg-[#0F2C59] text-white px-6 py-4 flex items-center justify-between border-b-2 border-[#D4AF37]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4AF37] text-[#0F2C59] flex items-center justify-center font-bold">
              <Upload size={18} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">Upload Your Logo As-Is</h2>
              <p className="text-[11px] text-amber-200">No alterations • Exact original file preserved</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Method tabs */}
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveMode('FILE')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                activeMode === 'FILE'
                  ? 'bg-white text-[#0F2C59] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Upload Image File
            </button>
            <button
              onClick={() => setActiveMode('URL')}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                activeMode === 'URL'
                  ? 'bg-white text-[#0F2C59] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Image Web Link
            </button>
          </div>

          {activeMode === 'FILE' ? (
            <div>
              {/* Drag and Drop Box */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-[#FF6B00] bg-orange-50'
                    : 'border-gray-300 hover:border-[#0F2C59] bg-gray-50/70 hover:bg-gray-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-full bg-blue-50 text-[#0F2C59] mx-auto flex items-center justify-center mb-3">
                  <Upload size={24} />
                </div>
                <div className="text-xs font-bold text-gray-800 mb-1">
                  Click to choose file or drag & drop here
                </div>
                <p className="text-[11px] text-gray-500 max-w-xs mx-auto">
                  Select your original file (e.g. <span className="font-mono text-gray-700 font-semibold">SAVE_20260828_130926.jpg</span>) directly from your device.
                </p>
                <div className="mt-2 text-[10px] text-gray-400 font-medium">
                  Supports JPG, PNG, WEBP, SVG • Saved exactly as uploaded
                </div>
              </div>

              {fileDetails && (
                <div className="mt-2.5 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800 font-medium">
                  <span className="truncate max-w-[260px]">Selected: <strong className="font-semibold">{fileDetails.name}</strong></span>
                  <span className="text-[10px] bg-emerald-200 px-2 py-0.5 rounded font-mono font-bold">{fileDetails.size}</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                Direct Image Link (URL)
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/my-original-logo.jpg"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setPreviewUrl(e.target.value);
                  }}
                  className="flex-1 p-2.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0F2C59] outline-none"
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Paste any hosted direct image URL to apply as your store logo.
              </p>
            </div>
          )}

          {/* Live Preview Section */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-2">
            <div className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center justify-between">
              <span>Preview Live App Display</span>
              {previewUrl && (
                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 px-2 py-0.5 rounded">
                  Active in preview
                </span>
              )}
            </div>

            {/* Simulated Header Preview */}
            <div className="bg-[#0F2C59] p-3 rounded-xl flex items-center justify-between border border-[#D4AF37]/50 shadow-inner">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/90 border-2 border-[#D4AF37] flex items-center justify-center overflow-hidden shrink-0 shadow">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Logo Preview"
                      className="w-full h-full object-contain p-0.5"
                    />
                  ) : (
                    <div className="text-center font-black text-[#0F2C59] text-xs">
                      OM
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-black text-[#D4AF37] leading-none">
                    {settings.appName.toUpperCase()}
                  </div>
                  <div className="text-[10px] text-gray-300 mt-1">
                    Multi Service Provider • We meet your needs.
                  </div>
                </div>
              </div>
              <span className="text-[10px] bg-[#FF6B00] text-white px-2 py-1 rounded font-bold uppercase">
                Header
              </span>
            </div>
          </div>

          {statusMessage && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-medium animate-fade-in">
              <AlertCircle size={16} className="text-blue-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={handleResetToDefault}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
            >
              <RotateCcw size={14} />
              <span>Reset to Default</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveLogo}
                disabled={!previewUrl && activeMode === 'FILE'}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-black text-white bg-[#0F2C59] hover:bg-[#163a6e] rounded-xl shadow-md transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={16} className="text-[#D4AF37]" />
                <span>Save Logo As-Is</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
