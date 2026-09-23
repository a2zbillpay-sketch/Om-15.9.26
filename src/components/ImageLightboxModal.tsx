import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  title?: string;
  subtitle?: string;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title,
  subtitle,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    let isClosedByPopState = false;
    try {
      window.history.pushState({ lightbox: true }, '');
    } catch {
      // Ignore if history pushState is restricted
    }

    const handlePopState = () => {
      isClosedByPopState = true;
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);

      if (!isClosedByPopState && window.history.state?.lightbox) {
        try {
          window.history.back();
        } catch {
          // Ignore
        }
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      id="product-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Product Photo Preview'}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-3 sm:p-6 select-none animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Header bar with product info & Close button */}
      <div
        className="w-full max-w-4xl flex items-center justify-between px-2 py-2 text-white shrink-0 pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 pr-4">
          {subtitle && (
            <span className="text-[11px] font-black uppercase tracking-wider text-[#FF6B00] block truncate">
              {subtitle}
            </span>
          )}
          {title && (
            <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
              {title}
            </h3>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          id="btn-close-image-lightbox"
          aria-label="Close image preview"
          className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition border border-white/20 shrink-0 cursor-pointer"
        >
          <X size={20} />
        </button>
      </div>

      {/* Centered Image Area */}
      <div
        className="flex-1 w-full max-w-4xl flex items-center justify-center min-h-0 py-2 cursor-pointer"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <div className="relative max-h-full max-w-full flex items-center justify-center p-1">
          <img
            src={imageUrl}
            alt={title || 'Product Photo Preview'}
            className="max-h-[75vh] sm:max-h-[80vh] max-w-full object-contain rounded-2xl shadow-2xl bg-white border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {/* Footer hint */}
      <div
        className="text-[11px] text-gray-400 py-1 shrink-0 text-center pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        Tap outside, press ESC or Back to close
      </div>
    </div>
  );
};
