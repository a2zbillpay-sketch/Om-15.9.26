import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Upload,
  Keyboard,
  Scan,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Product } from '../types';
import { normalizeAndValidateBarcode } from '../lib/product-service';

export interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedBarcode: string) => void;
  title?: string;
  subtitle?: string;
  currentBarcode?: string;
  existingProducts?: Product[];
  excludeProductId?: string;
  allowDuplicates?: boolean;
}

// POS scan confirmation chime
function playScanChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1750, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch {
    // AudioContext blocked or not supported, ignore silently
  }
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Scan Product Barcode',
  subtitle = 'Point your camera at the barcode on the product packaging',
  currentBarcode = '',
  existingProducts = [],
  excludeProductId,
  allowDuplicates = false,
}) => {
  const [scannerActive, setScannerActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanFormat, setScanFormat] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Manual fallback state inside modal
  const [manualInput, setManualInput] = useState(currentBarcode || '');
  const [showManualInput, setShowManualInput] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerElementId = 'om-barcode-reader-viewport';

  // Formats specifically tuned for retail grocery and wholesale packaging
  const formatsToSupport = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.CODE_93,
    Html5QrcodeSupportedFormats.CODABAR,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.DATA_MATRIX,
  ];

  // Stop scanner safely
  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch (err) {
      console.warn('Error stopping barcode scanner:', err);
    } finally {
      setScannerActive(false);
      setTorchEnabled(false);
      setHasTorch(false);
    }
  };

  // Process a scanned raw string through the centralized normalization & validation pipeline
  const handleBarcodeDetected = (rawCode: string, formatName?: string) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);

    // 1. Centralized validation & normalization
    const validation = normalizeAndValidateBarcode(rawCode);
    if (!validation.valid || !validation.barcode) {
      setErrorMessage(validation.error || 'Invalid barcode detected.');
      setIsProcessing(false);
      return;
    }

    const validatedBarcode = validation.barcode;

    // 2. Duplicate check against existing products
    if (!allowDuplicates && existingProducts.length > 0) {
      const conflict = existingProducts.find(
        (p) =>
          p.id !== excludeProductId &&
          p.barcode &&
          p.barcode.trim().toLowerCase() === validatedBarcode.toLowerCase()
      );
      if (conflict) {
        setErrorMessage(
          `Barcode "${validatedBarcode}" is already assigned to "${conflict.name}" (${conflict.brand || 'Product'}). Barcodes must be unique.`
        );
        setIsProcessing(false);
        return;
      }
    }

    // 3. Successful scan: trigger feedback
    playScanChime();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(60);
      } catch {
        // ignore
      }
    }

    setScanResult(validatedBarcode);
    setScanFormat(formatName || 'Barcode');

    // Brief delay to display the success confirmation pill in the viewfinder before applying
    setTimeout(async () => {
      await stopScanner();
      onScan(validatedBarcode);
      onClose();
    }, 450);
  };

  // Start the camera scanner
  const startScanner = async (cameraId?: string) => {
    setCameraError(null);
    setErrorMessage(null);
    setScanResult(null);

    // Ensure DOM container exists
    const container = document.getElementById(readerElementId);
    if (!container) {
      setTimeout(() => startScanner(cameraId), 100);
      return;
    }

    try {
      // Clean up previous instance if running
      await stopScanner();

      const scanner = new Html5Qrcode(readerElementId, {
        formatsToSupport,
        verbose: false,
      });
      scannerRef.current = scanner;

      // Query available video devices
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setCameras(devices);
          if (!cameraId && !selectedCameraId) {
            // Prefer back/environment facing camera
            const backCam = devices.find(
              (d) =>
                d.label.toLowerCase().includes('back') ||
                d.label.toLowerCase().includes('rear') ||
                d.label.toLowerCase().includes('environment')
            );
            const targetId = backCam ? backCam.id : devices[0].id;
            setSelectedCameraId(targetId);
            cameraId = targetId;
          }
        }
      } catch {
        // Device query may fail on some browsers before permission, will use facingMode instead
      }

      const cameraConfig = cameraId ? { deviceId: { exact: cameraId } } : { facingMode: 'environment' };

      await scanner.start(
        cameraConfig,
        {
          fps: 15,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            // Optimal rectangular frame for 1D grocery barcodes
            const width = Math.floor(viewfinderWidth * 0.82);
            const height = Math.floor(Math.min(viewfinderHeight * 0.55, 180));
            return { width, height };
          },
          aspectRatio: 1.0,
        },
        (decodedText, decodedResult) => {
          const formatStr = decodedResult?.result?.format?.formatName || 'BARCODE';
          handleBarcodeDetected(decodedText, formatStr);
        },
        () => {
          // Frame-level decode pass (silent)
        }
      );

      setScannerActive(true);

      // Check torch / flashlight capability
      try {
        const capabilities = scanner.getRunningTrackCapabilities();
        if (capabilities && (capabilities as any).torch) {
          setHasTorch(true);
        }
      } catch {
        setHasTorch(false);
      }
    } catch (err: any) {
      console.warn('Failed to start camera scanner:', err);
      setScannerActive(false);

      const errName = err?.name || '';
      const errMsg = err?.message || String(err);

      if (errName === 'NotAllowedError' || errMsg.includes('Permission') || errMsg.includes('denied')) {
        setCameraError('Camera access was denied. Please allow camera permissions in your browser settings, or enter the barcode manually below.');
      } else if (errName === 'NotFoundError' || errMsg.includes('DevicesNotFoundError') || errMsg.includes('not found')) {
        setCameraError('No camera found on this device. You can enter or paste the barcode manually below.');
      } else {
        setCameraError(
          'Unable to access camera (' + (errMsg || 'device busy or unavailable') + '). You can enter the barcode manually below.'
        );
      }
    }
  };

  // Toggle torch / flashlight
  const toggleTorch = async () => {
    if (!scannerRef.current || !hasTorch) return;
    try {
      const nextState = !torchEnabled;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextState }] as any,
      });
      setTorchEnabled(nextState);
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  };

  // Switch camera device
  const handleCameraChange = async (newCameraId: string) => {
    setSelectedCameraId(newCameraId);
    await startScanner(newCameraId);
  };

  // Scan from uploaded image file fallback
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setIsProcessing(true);

    try {
      let scanner = scannerRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(readerElementId, {
          formatsToSupport,
          verbose: false,
        });
        scannerRef.current = scanner;
      }

      if (scanner.isScanning) {
        await scanner.stop();
        setScannerActive(false);
      }

      const result = await scanner.scanFileV2(file, false);
      if (result && result.decodedText) {
        const formatStr = result.result?.format?.formatName || 'BARCODE';
        handleBarcodeDetected(result.decodedText, formatStr);
      } else {
        setErrorMessage('Could not detect a clear barcode in the uploaded photo. Please try a clearer picture.');
        setIsProcessing(false);
      }
    } catch (err: any) {
      console.warn('Image barcode scan error:', err);
      setErrorMessage('Could not read a barcode from this image. Ensure the barcode is flat and well-lit.');
      setIsProcessing(false);
    } finally {
      // Clear input so user can re-upload same file if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Apply manual input
  const handleApplyManual = () => {
    const trimmed = manualInput.trim();
    if (!trimmed) {
      setErrorMessage('Please enter a barcode number.');
      return;
    }
    handleBarcodeDetected(trimmed, 'MANUAL_INPUT');
  };

  // Initialize or teardown when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setManualInput(currentBarcode || '');
      setScanResult(null);
      setErrorMessage(null);
      setIsProcessing(false);
      startScanner();
    } else {
      stopScanner();
    }

    return () => {
      stopScanner();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      id="barcode-scanner-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        id="barcode-scanner-modal-card"
        className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col border border-gray-100 max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 bg-[#0F2C59] text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Scan className="w-4 h-4 text-[#FF6B00]" />
            </div>
            <div>
              <h3 className="font-bold text-sm leading-tight text-white">{title}</h3>
              <p className="text-[11px] text-gray-300 line-clamp-1">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            id="barcode-scanner-close-btn"
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close Scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="p-4 flex-1 flex flex-col overflow-y-auto">
          {/* Active Camera Viewfinder */}
          <div className="relative w-full aspect-square max-h-72 bg-gray-950 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center shadow-inner">
            {/* Target element for html5-qrcode video */}
            <div
              id={readerElementId}
              className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
            />

            {/* Viewfinder HUD Overlays when scanning */}
            {scannerActive && !scanResult && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {/* Visual scan reticle */}
                <div className="w-[82%] h-[55%] max-h-44 border-2 border-[#FF6B00]/70 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                  {/* Corner brackets */}
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-white" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-white" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-white" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-white" />

                  {/* Animated laser line */}
                  <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-[#FF6B00] to-transparent animate-pulse absolute top-1/2 -translate-y-1/2 shadow-[0_0_8px_#FF6B00]" />
                </div>
              </div>
            )}

            {/* Success Scan Flash */}
            {scanResult && (
              <div className="absolute inset-0 bg-emerald-950/85 backdrop-blur-xs flex flex-col items-center justify-center text-white p-4 text-center z-10 animate-in zoom-in-95 duration-150">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-2 animate-bounce" />
                <div className="text-xs font-semibold text-emerald-200 tracking-wide uppercase">
                  {scanFormat || 'Barcode Scanned'}
                </div>
                <div className="text-lg font-mono font-bold tracking-wider mt-1 text-white bg-emerald-900/60 px-3 py-1 rounded-lg border border-emerald-500/30">
                  {scanResult}
                </div>
                <div className="text-[11px] text-emerald-300 mt-2">Applying to product...</div>
              </div>
            )}

            {/* Camera Permission / Availability Error State */}
            {cameraError && !scannerActive && (
              <div className="absolute inset-0 bg-gray-900 flex flex-col items-center justify-center p-5 text-center text-white z-10">
                <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mb-3">
                  <CameraOff className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-red-200 mb-1">Camera Unavailable</h4>
                <p className="text-xs text-gray-300 leading-relaxed mb-4 max-w-xs">{cameraError}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startScanner(selectedCameraId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualInput(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FF6B00] hover:bg-[#E05E00] text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                    Enter Manually
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Viewfinder Controls Bar (Camera Switch, Torch, File Upload) */}
          <div className="flex items-center justify-between gap-2 mt-3 px-1">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Camera className="w-3.5 h-3.5 text-gray-400" />
              {cameras.length > 1 ? (
                <select
                  value={selectedCameraId}
                  onChange={(e) => handleCameraChange(e.target.value)}
                  className="text-xs bg-gray-50 border border-gray-200 rounded px-1.5 py-1 text-gray-700 outline-none max-w-[140px] truncate"
                >
                  {cameras.map((c, i) => (
                    <option key={c.id} value={c.id}>
                      {c.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span>Auto-detect</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Torch toggle button */}
              {hasTorch && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`p-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors ${
                    torchEnabled
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                  }`}
                  title={torchEnabled ? 'Turn Off Light' : 'Turn On Light'}
                >
                  {torchEnabled ? <Flashlight className="w-3.5 h-3.5" /> : <FlashlightOff className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline text-[11px]">{torchEnabled ? 'Light On' : 'Flashlight'}</span>
                </button>
              )}

              {/* Upload image of barcode fallback */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                id="barcode-image-upload-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg border border-gray-200 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium flex items-center gap-1 transition-colors"
                title="Scan barcode from a saved photo"
              >
                <Upload className="w-3.5 h-3.5 text-gray-600" />
                <span className="hidden sm:inline text-[11px]">Upload Photo</span>
              </button>

              {/* Manual input toggle */}
              <button
                type="button"
                onClick={() => setShowManualInput(!showManualInput)}
                className={`p-1.5 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors ${
                  showManualInput
                    ? 'bg-[#0F2C59] text-white border-[#0F2C59]'
                    : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                }`}
                title="Enter barcode digits manually"
              >
                <Keyboard className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[11px]">Manual</span>
              </button>
            </div>
          </div>

          {/* Validation or Duplicate Error Alert Banner */}
          {errorMessage && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block">Barcode Error</span>
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setIsProcessing(false);
                }}
                className="text-red-400 hover:text-red-700 font-bold px-1"
              >
                ×
              </button>
            </div>
          )}

          {/* Manual Input Fallback Drawer */}
          {(showManualInput || cameraError) && (
            <div className="mt-3.5 pt-3 border-t border-gray-100">
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Enter Barcode Number Manually:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="scanner-manual-barcode-input"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleApplyManual();
                    }
                  }}
                  placeholder="e.g. 8901030383321"
                  className="flex-1 p-2 border border-gray-300 rounded-xl font-mono text-sm text-gray-900 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] outline-none"
                />
                <button
                  type="button"
                  id="scanner-apply-manual-btn"
                  onClick={handleApplyManual}
                  disabled={!manualInput.trim()}
                  className="px-3.5 py-2 bg-[#0F2C59] hover:bg-[#1a3f7a] text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Supports standard grocery EAN-13, EAN-8, UPC, and Code 128 barcodes.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[11px] text-gray-500">
            {scannerActive ? '🟢 Camera active' : '⚪ Camera idle'}
          </span>
          <button
            type="button"
            id="barcode-scanner-cancel-btn"
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
