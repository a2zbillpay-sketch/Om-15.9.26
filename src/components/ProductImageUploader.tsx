import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
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
  Crop,
  Maximize2,
  X,
  Square,
} from 'lucide-react';
import {
  optimizeProductImage,
  uploadProductImageToStorage,
  validateImageUrl,
  validateImageFile,
  SquareFitMode,
  renderSquareToCanvas,
} from '../lib/image-service';

export interface ProductImageUploaderProps {
  currentImageUrl?: string;
  onImageChange: (newUrl: string) => void;
  productName?: string;
  label?: string;
  subLabel?: string;
  idPrefix?: string;
}

interface PendingCropFile {
  file: File;
  objectUrl: string;
  imageElement: HTMLImageElement;
  origWidth: number;
  origHeight: number;
  fitMode: SquareFitMode;
}

export const ProductImageUploader: React.FC<ProductImageUploaderProps> = ({
  currentImageUrl = '',
  onImageChange,
  productName = 'Product',
  label = 'Product Photo',
  subLabel = '(1:1 Square Format)',
  idPrefix = 'product',
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);

  const [activeTab, setActiveTab] = useState<'ACTIONS' | 'URL'>('ACTIONS');
  const [manualUrl, setManualUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingCrop, setPendingCrop] = useState<PendingCropFile | null>(null);
  const [optimizationStats, setOptimizationStats] = useState<{
    originalKb: number;
    optimizedKb: number;
    isCloud: boolean;
    dimension: number;
  } | null>(null);

  const hasImage = Boolean(currentImageUrl && currentImageUrl.trim());

  // Render live 1:1 preview whenever pending crop state changes
  useEffect(() => {
    if (!pendingCrop || !modalCanvasRef.current) return;

    const canvas = modalCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const PREVIEW_SIZE = 600;
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;

    renderSquareToCanvas(
      ctx,
      pendingCrop.imageElement,
      pendingCrop.origWidth,
      pendingCrop.origHeight,
      PREVIEW_SIZE,
      pendingCrop.fitMode,
      '#FFFFFF'
    );
  }, [pendingCrop?.fitMode, pendingCrop?.imageElement, pendingCrop?.origWidth, pendingCrop?.origHeight]);

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setErrorMessage(null);
    setStatusMessage(null);
    setOptimizationStats(null);

    // Initial format and size validation
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid image file.');
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
      return;
    }

    // Load into memory for 1:1 square crop/fit review
    const objUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const origWidth = img.naturalWidth || img.width;
      const origHeight = img.naturalHeight || img.height;

      setPendingCrop({
        file,
        objectUrl: objUrl,
        imageElement: img,
        origWidth,
        origHeight,
        fitMode: 'crop', // Default to center-crop 1:1 fill
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      setErrorMessage('Failed to read image file. Please choose another image.');
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    };

    img.src = objUrl;
  };

  const handleCancelCrop = () => {
    if (pendingCrop) {
      URL.revokeObjectURL(pendingCrop.objectUrl);
    }
    setPendingCrop(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  const handleConfirmSquarePhoto = async () => {
    if (!pendingCrop) return;

    const { file, fitMode, objectUrl } = pendingCrop;
    URL.revokeObjectURL(objectUrl);
    setPendingCrop(null);

    setIsProcessing(true);
    setProcessingStage('Generating 1:1 square photo & compressing...');

    try {
      // Optimize to 1:1 square without distortion
      const optimized = await optimizeProductImage(file, {
        maxDimension: 1000,
        quality: 0.85,
        fitMode,
        backgroundColor: '#FFFFFF',
      });

      setProcessingStage('Uploading 1:1 square photo to cloud storage...');

      // Upload square blob to storage
      const uploadResult = await uploadProductImageToStorage(optimized.blob, file.name);

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || 'Failed to upload photo to storage.');
      }

      onImageChange(uploadResult.url);

      const originalKb = Math.round(optimized.originalSize / 1024);
      const optimizedKb = Math.round(optimized.optimizedSize / 1024);

      setOptimizationStats({
        originalKb,
        optimizedKb,
        isCloud: uploadResult.isCloudStorage,
        dimension: optimized.width,
      });

      setStatusMessage(
        uploadResult.isCloudStorage
          ? `1:1 Square photo saved! (${optimized.width}×${optimized.height}px, ${optimizedKb} KB)`
          : `1:1 Square photo ready! (${optimized.width}×${optimized.height}px, ${optimizedKb} KB)`
      );
    } catch (err: any) {
      console.error('Image processing failure:', err);
      setErrorMessage(err.message || 'Image processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
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
    <div className="space-y-2.5" id={`${idPrefix}-image-uploader-section`}>
      <div className="flex items-center justify-between">
        <label className="font-bold text-gray-700 text-xs flex items-center gap-1.5">
          <span>{label}</span>
          <span className="text-gray-400 font-normal">{subLabel}</span>
        </label>
        {hasImage && (
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-1">
            <Check size={11} className="text-emerald-600" />
            1:1 Photo Attached
          </span>
        )}
      </div>

      {/* Hidden File Inputs for Camera and Gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        id={`${idPrefix}-camera-photo-input`}
        accept="image/jpeg,image/png,image/webp,image/gif"
        capture="environment"
        className="hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        id={`${idPrefix}-gallery-photo-input`}
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Main Container Card */}
      <div className="bg-gray-50/70 border border-gray-200 rounded-xl p-3">
        <div className="flex flex-col sm:flex-row gap-3 items-center sm:items-start">
          {/* Image Thumbnail / Preview Card - Strict 1:1 Aspect Ratio Box */}
          <div className="relative group shrink-0">
            {hasImage ? (
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-gray-200 bg-white shadow-xs aspect-square">
                <img
                  src={currentImageUrl}
                  alt={productName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={() => {
                    setErrorMessage('Failed to load image from URL. It may be broken or inaccessible.');
                  }}
                />
                <span className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-xs text-white text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase">
                  1:1
                </span>
                <button
                  type="button"
                  id={`${idPrefix}-remove-image-btn`}
                  onClick={handleRemoveImage}
                  className="absolute top-1.5 right-1.5 p-1 bg-red-600/90 text-white rounded-lg opacity-90 hover:opacity-100 transition shadow-xs cursor-pointer"
                  title="Remove product photo"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-gray-300 bg-white flex flex-col items-center justify-center text-gray-400 p-2 text-center aspect-square">
                <Square size={26} className="text-gray-300 mb-1" />
                <span className="text-[10px] font-semibold text-gray-400">1:1 Square</span>
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
                id={`${idPrefix}-take-photo-btn`}
                disabled={isProcessing}
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-gray-200 hover:border-[#0F2C59] hover:bg-blue-50/30 text-gray-700 hover:text-[#0F2C59] transition shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50"
                title="Open camera to take a 1:1 product photo"
              >
                <Camera size={16} className="text-[#FF6B00] mb-0.5" />
                <span className="text-[11px] font-bold">Take Photo</span>
                <span className="text-[9px] text-gray-400">Camera</span>
              </button>

              {/* Option 2: Choose Photo from Gallery */}
              <button
                type="button"
                id={`${idPrefix}-choose-gallery-btn`}
                disabled={isProcessing}
                onClick={() => galleryInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-gray-200 hover:border-[#0F2C59] hover:bg-blue-50/30 text-gray-700 hover:text-[#0F2C59] transition shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50"
                title="Select existing photo from device files or photo library"
              >
                <ImageIcon size={16} className="text-[#0F2C59] mb-0.5" />
                <span className="text-[11px] font-bold">Choose</span>
                <span className="text-[9px] text-gray-400">Gallery</span>
              </button>

              {/* Option 3: Manual Image URL */}
              <button
                type="button"
                id={`${idPrefix}-paste-url-btn`}
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
                    id={`${idPrefix}-manual-image-url-input`}
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="https://example.com/product.jpg"
                    className="flex-1 p-2 text-xs border border-gray-300 rounded-lg outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] bg-white text-gray-900"
                    autoFocus
                  />
                  <button
                    type="submit"
                    id={`${idPrefix}-apply-image-url-btn`}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-[#0F2C59] hover:bg-[#163a6e] rounded-lg transition shrink-0 cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-[10px] text-gray-400">
                  Paste a direct link to a square product image (HTTPS recommended).
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
                <span>Square 1:1 auto-adjusted (JPEG/PNG, Max 15MB).</span>
                <span className="text-[#0F2C59] font-medium flex items-center gap-0.5">
                  <Cloud size={11} className="text-[#0F2C59]" />
                  Compressed for fast load
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 1:1 SQUARE CROP & FIT MODAL - Allows User to Confirm or Toggle Crop vs Fit without Distortion */}
      {pendingCrop && (
        <div
          id="square-photo-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-sm w-full p-4 sm:p-5 space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-extrabold text-[#0F2C59] text-sm flex items-center gap-1.5">
                  <Square size={16} className="text-[#FF6B00]" />
                  Square 1:1 Photo Format
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Fitted to 1:1 square ratio without distortion
                </p>
              </div>
              <button
                type="button"
                id="close-square-modal-btn"
                onClick={handleCancelCrop}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                title="Cancel"
              >
                <X size={18} />
              </button>
            </div>

            {/* Live 1:1 Canvas Preview */}
            <div className="space-y-2">
              <div className="relative w-56 h-56 mx-auto rounded-xl overflow-hidden border-2 border-gray-200 bg-white shadow-inner flex items-center justify-center">
                <canvas
                  ref={modalCanvasRef}
                  id="square-preview-canvas"
                  className="w-full h-full object-contain"
                />
                <span className="absolute top-2 left-2 bg-[#0F2C59]/80 backdrop-blur-xs text-white text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  1:1 Preview
                </span>
              </div>
              <p className="text-[10px] text-center text-gray-400">
                Original photo: {pendingCrop.origWidth} × {pendingCrop.origHeight} px
              </p>
            </div>

            {/* Format Selection Buttons: Crop Center vs Fit Full Image */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-700 block">Choose Format Style:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  id="crop-mode-crop-btn"
                  onClick={() => setPendingCrop({ ...pendingCrop, fitMode: 'crop' })}
                  className={`p-2 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    pendingCrop.fitMode === 'crop'
                      ? 'border-[#0F2C59] bg-blue-50/50 text-[#0F2C59] ring-1 ring-[#0F2C59]'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Crop size={14} className={pendingCrop.fitMode === 'crop' ? 'text-[#FF6B00]' : 'text-gray-400'} />
                    <span className="text-xs font-bold">Fill Square</span>
                  </div>
                  <span className="text-[10px] text-gray-500 leading-tight">
                    Crops edges to fill 1:1 square. Best for close-ups.
                  </span>
                </button>

                <button
                  type="button"
                  id="crop-mode-contain-btn"
                  onClick={() => setPendingCrop({ ...pendingCrop, fitMode: 'contain' })}
                  className={`p-2 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    pendingCrop.fitMode === 'contain'
                      ? 'border-[#0F2C59] bg-blue-50/50 text-[#0F2C59] ring-1 ring-[#0F2C59]'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Maximize2 size={14} className={pendingCrop.fitMode === 'contain' ? 'text-[#FF6B00]' : 'text-gray-400'} />
                    <span className="text-xs font-bold">Fit Entire Item</span>
                  </div>
                  <span className="text-[10px] text-gray-500 leading-tight">
                    Shows entire photo on clean white 1:1 frame.
                  </span>
                </button>
              </div>
            </div>

            {/* Modal Action Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                id="cancel-square-crop-btn"
                onClick={handleCancelCrop}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="confirm-square-crop-btn"
                onClick={handleConfirmSquarePhoto}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#0F2C59] hover:bg-[#163a6e] transition flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Check size={14} />
                Confirm 1:1 Photo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

