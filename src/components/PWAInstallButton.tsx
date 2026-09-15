import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'prominent' }> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, triggerInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    if (variant === 'prominent') {
      return (
        <button
          id="pwa-install-banner-btn"
          onClick={triggerInstall}
          className="flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#b89528] text-[#0F2C59] font-extrabold px-4 py-2.5 rounded-xl shadow-md transition text-xs"
        >
          <Download size={16} />
          <span>Install Om Distributors App</span>
        </button>
      );
    }

    return (
      <button
        id="pwa-install-header-btn"
        onClick={triggerInstall}
        className="flex items-center gap-1.5 bg-[#D4AF37] text-[#0F2C59] hover:bg-[#e6c453] px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition"
        title="Install app to your home screen"
      >
        <Download size={14} />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 border border-[#D4AF37]/50 text-[#D4AF37] hover:bg-white/10 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition"
        >
          <Smartphone size={14} />
          <span className="hidden sm:inline">Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border-t-4 border-[#0F2C59]">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-base font-bold text-[#0F2C59]">Install on iPhone / iPad</h3>
                <button onClick={() => setShowIOSGuide(false)} className="text-gray-400 hover:text-gray-700">
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed space-y-1">
                <span>1. Tap the <strong>Share</strong> button in your Safari navigation toolbar.</span>
                <br />
                <span>2. Scroll down and tap <strong>Add to Home Screen</strong>.</span>
              </p>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-[#0F2C59] py-2.5 text-xs font-bold text-white shadow hover:bg-[#153e7d]"
              >
                Got It
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
