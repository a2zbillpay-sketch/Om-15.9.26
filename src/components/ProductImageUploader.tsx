import React, { useState, useRef, ChangeEvent } from 'react';
import {
  Camera,
  Image as ImageIcon,
  Link2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Cloud,
  Check,
  RefreshCw,
} from 'lucide-react';
import {
  optimizeProductImage,
  uploadProductImageToStorage,
  validateImageUrl,
  validateImageFile,
} from '../lib/image-service';

export interface ProductImageUploaderProps {
  currentImageUrl?: string;
  onImageChange: (newUrl: string) => void;
  productName?: string;
}

export const ProductImageUploader: React.FC<ProductImageUploaderProps> = ({
  currentImageUrl = '',
  onImageChange,
  productName = 'Product',
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'ACTIONS' | 'URL'>('ACTIONS');
  const [manualUrl, setManualUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [optimizationStats, setOptimizationStats] = useState<{
    originalKb: number;
    optimizedKb: number;
    isCloud: boolean;
  } | null>(null);

  const hasImage = Boolean(currentImageUrl && currentImageUrl.trim());

  const handleProcessSelectedFile = async (file: File) => {
    setErrorMessage(null);
    setStatusMessage(null);
    setOptimizationStats(null);

    // 1. Initial file check
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid image file.');
      return;
    }

    setIsProcessing(true);
    setProcessingStage('Optimizing and compressing photo...');

    try {
      // 2. Client-side Canvas optimization (scales down multi-megapixel phone camera captures)
      const optimized = await optimizeProductImage(file, 1000, 0.85);

      setProcessingStage('Uploading to cloud storage...');

      // 3. Upload to cloud storage (Supabase Storage)
      const uploadResult = await uploadProductImageToStorage(optimized.blob, file.name);

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || 'Failed to upload photo to storage.');
      }

      // 4. Update the existing product imageUrl field with the resulting cloud URL
      onImageChange(uploadResult.url);

      const originalKb = Math.round(optimized.originalSize / 1024);
      const optimizedKb = Math.round(optimized.optimizedSize / 1024);

      setOptimizationStats({
        originalKb,
        optimizedKb,
        isCloud: uploadResult.isCloudStorage,
      });

      setStatusMessage(
        uploadResult.isCloudStorage
          ? `Cloud image stored! (${originalKb} KB → ${optimizedKb} KB)`
          : `Image optimized! (${originalKb} KB → ${optimizedKb} KB)`
      );
    } catch (err: any) {
      console.error('Image processing failure:', err);
      setErrorMessage(err.message || 'Image upload failed. Please try again.');
      // Do not clear the existing image on failure!
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
      // Reset input values so the user can re-select or re-capture the same file if needed
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleProcessSelectedFile(files[0]);
    }
  };

  const handleApplyManualUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setOptimizationStats(null);

    const validation = validateImageUrl(manualUrl);
    if (!validation.valid || !validation.cleanUrl) {
      setErrorMessage(validation.error || 'Please enter a valid web image URL.');
      return;
    }

    onImageChange(validation.cleanUrl);
    setStatusMessage('Image URL applied successfully.');
    setManualUrl('');
    setActiveTab('ACTIONS');
  };

  const handleRemoveImage = () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setOptimizationStats(null);
    onImageChange('');
  };

  return (
    <div className="space-y-2.5" id="product-image-uploader-section">
      <div className="flex items-center justify-between">
        <label className="font-bold text-gray-700 text-xs">
          Product Photo <span className="text-gray-400 font-normal">(Optional)</span>
        </label>
        {hasImage && (
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1">
            <Check size={11} className="text-emerald-600" />
            Photo Attached
          </span>
        )}
      </div>

      {/* Hidden File Inputs for Camera and Gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        id="camera-photo-input"
        accept="image/jpeg,image/png,image/webp,image/gif"
        capture="environment"
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        id="gallery-photo-input"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Main Container Card */}
      <div className="bg-gray-50/70 border border-gray-200 rounded-xl p-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center sm:items-start">
          {/* Image Thumbnail / Preview Card */}
          <div className="relative group shrink-0">
            {hasImage ? (
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-xs">
                <img
                  src={currentImageUrl}
                  alt={productName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={() => {
                    setErrorMessage('Failed to load image from URL. It may be broken or inaccessible.');
                  }}
                />
                <button
                  type="button"
                  id="remove-product-image-btn"
                  onClick={handleRemoveImage}
                  className="absolute top-1.5 right-1.5 p-1 bg-red-600/90 text-white rounded-lg opacity-90 hover:opacity-100 transition shadow-xs cursor-pointer"
                  title="Remove product photo"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center text-gray-400 p-2 text-center">
                <ImageIcon size={26} className="text-gray-300 mb-1" />
                <span className="text-[10px] font-semibold text-gray-400">No Image</span>
              </div>
            )}
          </div>

          {/* Action Controls & Tabs */}
          <div className="flex-1 w-full space-y-2">
            {/* Action Buttons (Take Photo, Gallery, Paste URL) */}
            <div className="grid grid-cols-3 gap-1.5">
              {/* Option 1: Take Photo with Camera */}
              <button
                type="button"
                id="take-photo-btn"
                disabled={isProcessing}
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-gray-200 hover:border-[#0F2C59] hover:bg-blue-50/30 text-gray-700 hover:text-[#0F2C59] transition shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50"
                title="Open mobile camera to take product photo"
              >
                <Camera size={16} className="text-[#FF6B00] mb-0.5" />
                <span className="text-[11px] font-bold">Take Photo</span>
                <span className="text-[9px] text-gray-400">Camera</span>
              </button>

              {/* Option 2: Choose Photo from Gallery */}
              <button
                type="button"
                id="choose-gallery-btn"
                disabled={isProcessing}
                onClick={() => galleryInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-gray-200 hover:border-[#0F2C59] hover:bg-blue-50/30 text-gray-700 hover:text-[#0F2C59] transition shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50"
                title="Select existing photo from phone gallery or files"
              >
                <ImageIcon size={16} className="text-[#0F2C59] mb-0.5" />
                <span className="text-[11px] font-bold">Choose</span>
                <span className="text-[9px] text-gray-400">Gallery</span>
              </button>

              {/* Option 3: Manual Image URL */}
              <button
                type="button"
                id="paste-url-btn"
                disabled={isProcessing}
                onClick={() => setActiveTab(activeTab === 'URL' ? 'ACTIONS' : 'URL')}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border transition shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50 ${
                  activeTab === 'URL'
                    ? 'bg-[#0F2C59] text-white border-[#0F2C59]'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-[#0F2C59] hover:bg-blue-50/30 hover:text-[#0F2C59]'
                }`}
                title="Enter or paste an image URL manually"
              >
                <Link2 size={16} className={activeTab === 'URL' ? 'text-[#FF6B00]' : 'text-gray-500'} />
                <span className="text-[11px] font-bold">Image URL</span>
                <span className={`text-[9px] ${activeTab === 'URL' ? 'text-gray-300' : 'text-gray-400'}`}>Web Link</span>
              </button>
            </div>

            {/* URL Input Expandable Section */}
            {activeTab === 'URL' && (
              <form onSubmit={handleApplyManualUrl} className="pt-1 space-y-1.5 animate-in fade-in duration-150">
                <div className="flex gap-1.5">
                  <input
                    type="url"
                    id="manual-image-url-input"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="https://example.com/product.jpg"
                    className="flex-1 p-2 text-xs border border-gray-300 rounded-lg outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] bg-white text-gray-900"
                    autoFocus
                  />
                  <button
                    type="submit"
                    id="apply-image-url-btn"
                    className="px-3 py-1.5 text-xs font-bold text-white bg-[#0F2C59] hover:bg-[#163a6e] rounded-lg transition shrink-0 cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Paste a direct link to any web image (HTTPS recommended).
                </p>
              </form>
            )}

            {/* Processing / Progress State */}
            {isProcessing && (
              <div className="flex items-center gap-2 p-2 bg-blue-50 text-[#0F2C59] border border-blue-200 rounded-lg text-xs">
                <Loader2 size={14} className="animate-spin text-[#FF6B00] shrink-0" />
                <span className="font-semibold text-[11px]">{processingStage}</span>
              </div>
            )}

            {/* Status & Compression Summary Message */}
            {statusMessage && !errorMessage && (
              <div className="flex items-center gap-2 p-2 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs">
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                <span className="text-[11px] font-bold">{statusMessage}</span>
              </div>
            )}

            {/* Error Message Alert */}
            {errorMessage && (
              <div className="flex items-center gap-2 p-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">
                <AlertCircle size={14} className="text-red-600 shrink-0" />
                <span className="text-[11px] font-semibold">{errorMessage}</span>
              </div>
            )}

            {/* Helper Hint */}
            {!isProcessing && !statusMessage && !errorMessage && activeTab !== 'URL' && (
              <div className="flex items-center justify-between text-[10px] text-gray-500 pt-0.5">
                <span>Supports JPG, PNG, WebP, GIF (Max 15MB).</span>
                <span className="text-[#0F2C59] font-medium flex items-center gap-0.5">
                  <Cloud size={11} className="text-[#0F2C59]" />
                  Auto-compressed for fast loading
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
