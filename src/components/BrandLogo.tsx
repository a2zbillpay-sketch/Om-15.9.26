import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  className?: string;
  showTagline?: boolean;
  alt?: string;
  onClick?: () => void;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  className = '',
  showTagline = false,
  alt = 'Om Distributors Logo',
  onClick,
}) => {
  const { settings } = useApp();
  const [imageError, setImageError] = useState(false);

  // Determine size classes
  const sizeMap = {
    xs: 'w-7 h-7 text-[10px]',
    sm: 'w-9 h-9 text-xs',
    md: 'w-11 h-11 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-20 h-20 text-2xl',
    custom: '',
  };

  const containerSizeClass = sizeMap[size] || sizeMap.md;

  // Resolve the active logo URL (user uploaded file or default /logo.jpg)
  const activeLogoUrl =
    settings.logoUrl && settings.logoUrl.trim() !== ''
      ? settings.logoUrl
      : '/logo.jpg';

  const showImage = !imageError;

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      id="om-brand-logo-container"
    >
      <div
        className={`${containerSizeClass} rounded-xl overflow-hidden flex items-center justify-center shrink-0 border-2 border-[#D4AF37] bg-[#0F2C59] shadow-md transition-transform hover:scale-[1.02]`}
      >
        {showImage ? (
          <img
            src={activeLogoUrl}
            alt={alt}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full p-1"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="100" height="100" rx="16" fill="#0F2C59" />
            <circle cx="50" cy="50" r="42" stroke="#D4AF37" strokeWidth="2.5" />
            <circle cx="50" cy="50" r="37" stroke="#D4AF37" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            {/* Om glyph styling */}
            <text
              x="50"
              y="58"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontSize="34"
              fontWeight="900"
              fill="#D4AF37"
              textAnchor="middle"
            >
              OM
            </text>
            <text
              x="50"
              y="74"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontSize="7"
              fontWeight="800"
              fill="#FFFFFF"
              letterSpacing="1"
              textAnchor="middle"
            >
              DISTRIBUTORS
            </text>
          </svg>
        )}
      </div>

      {showTagline && (
        <div className="flex flex-col text-left leading-tight">
          <div className="font-black text-sm tracking-wide text-[#D4AF37]">
            {settings.appName || 'OM DISTRIBUTORS'}
          </div>
          <span className="text-[10px] text-gray-300 font-medium">
            Multi Service Provider • We meet your needs.
          </span>
        </div>
      )}
    </div>
  );
};
