import { supabase, isSupabaseConfigured } from './supabase';

export interface ImageOptimizationResult {
  blob: Blob;
  dataUrl: string;
  originalSize: number;
  optimizedSize: number;
  width: number;
  height: number;
  mimeType: string;
}

export interface ImageUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  isCloudStorage: boolean;
  originalSize?: number;
  optimizedSize?: number;
}

const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

const MAX_RAW_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB max raw input

/**
 * Validates whether the given file is a supported image format and within safe limits.
 */
export function validateImageFile(file: File | Blob): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No image file provided.' };
  }

  const mime = file.type ? file.type.toLowerCase() : '';
  if (!mime || !SUPPORTED_MIME_TYPES.includes(mime)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a standard product image (JPEG, PNG, WebP, or GIF).',
    };
  }

  if (file.size > MAX_RAW_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${sizeMb} MB) exceeds maximum allowed limit of 15 MB. Please select a smaller photo.`,
    };
  }

  return { valid: true };
}

export type SquareFitMode = 'crop' | 'contain';

export interface ImageOptimizationOptions {
  maxDimension?: number;
  quality?: number;
  fitMode?: SquareFitMode;
  backgroundColor?: string;
}

export interface SquareGeometry {
  canvasSize: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Calculates distortion-free geometry for 1:1 square canvas rendering.
 * - 'crop' (Center-Crop): crops equal margins from edges to fill 1:1 square. Zero distortion.
 * - 'contain' (Fit): scales entire image inside 1:1 square with background padding. Zero distortion.
 */
export function calculateSquareGeometry(
  origWidth: number,
  origHeight: number,
  maxDimension: number = 1000,
  fitMode: SquareFitMode = 'crop'
): SquareGeometry {
  if (fitMode === 'contain') {
    const maxDim = Math.max(origWidth, origHeight);
    const canvasSize = Math.min(maxDim, maxDimension);
    const scale = canvasSize / maxDim;
    const dw = origWidth * scale;
    const dh = origHeight * scale;
    const dx = (canvasSize - dw) / 2;
    const dy = (canvasSize - dh) / 2;
    return {
      canvasSize,
      sx: 0,
      sy: 0,
      sw: origWidth,
      sh: origHeight,
      dx,
      dy,
      dw,
      dh,
    };
  }

  // Center-crop (default): Take the largest centered square
  const minDim = Math.min(origWidth, origHeight);
  const canvasSize = Math.min(minDim, maxDimension);
  const sx = Math.round((origWidth - minDim) / 2);
  const sy = Math.round((origHeight - minDim) / 2);
  return {
    canvasSize,
    sx,
    sy,
    sw: minDim,
    sh: minDim,
    dx: 0,
    dy: 0,
    dw: canvasSize,
    dh: canvasSize,
  };
}

/**
 * Renders a source image onto a canvas in 1:1 square format without distortion.
 */
export function renderSquareToCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  origWidth: number,
  origHeight: number,
  canvasSize: number,
  fitMode: SquareFitMode = 'crop',
  backgroundColor: string = '#FFFFFF'
): void {
  const geom = calculateSquareGeometry(origWidth, origHeight, canvasSize, fitMode);

  ctx.clearRect(0, 0, canvasSize, canvasSize);

  if (fitMode === 'contain') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasSize, canvasSize);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    geom.sx,
    geom.sy,
    geom.sw,
    geom.sh,
    geom.dx,
    geom.dy,
    geom.dw,
    geom.dh
  );
}

/**
 * Resizes, crops/fits into a 1:1 SQUARE format without distortion, and compresses
 * the image on-device using HTML5 Canvas before uploading.
 * Produces guaranteed 1:1 aspect ratio images (width === height) optimized for mobile/web.
 */
export async function optimizeProductImage(
  file: File | Blob,
  maxDimensionOrOptions: number | ImageOptimizationOptions = 1000,
  legacyQuality: number = 0.85
): Promise<ImageOptimizationResult> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid image file.');
  }

  const options: ImageOptimizationOptions =
    typeof maxDimensionOrOptions === 'number'
      ? { maxDimension: maxDimensionOrOptions, quality: legacyQuality, fitMode: 'crop' }
      : { maxDimension: 1000, quality: 0.85, fitMode: 'crop', ...maxDimensionOrOptions };

  const maxDimension = options.maxDimension || 1000;
  const quality = options.quality !== undefined ? options.quality : 0.85;
  const fitMode: SquareFitMode = options.fitMode || 'crop';
  const backgroundColor = options.backgroundColor || '#FFFFFF';

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const origWidth = img.naturalWidth || img.width;
      const origHeight = img.naturalHeight || img.height;
      if (origWidth <= 0 || origHeight <= 0) {
        return reject(new Error('Image has invalid dimensions.'));
      }

      const geom = calculateSquareGeometry(origWidth, origHeight, maxDimension, fitMode);

      const canvas = document.createElement('canvas');
      canvas.width = geom.canvasSize;
      canvas.height = geom.canvasSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Failed to initialize canvas context for compression.'));
      }

      if (fitMode === 'contain') {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, geom.canvasSize, geom.canvasSize);
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        img,
        geom.sx,
        geom.sy,
        geom.sw,
        geom.sh,
        geom.dx,
        geom.dy,
        geom.dw,
        geom.dh
      );

      // Determine output mime
      const inputMime = file.type ? file.type.toLowerCase() : 'image/jpeg';
      // For square JPEG compression, use JPEG for small bandwidth footprint (~100-250KB)
      const outputMime = inputMime === 'image/png' && fitMode !== 'contain' ? 'image/png' : 'image/jpeg';

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return reject(new Error('Failed to encode optimized 1:1 square image.'));
          }

          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({
              blob,
              dataUrl: reader.result as string,
              originalSize: file.size,
              optimizedSize: blob.size,
              width: geom.canvasSize,
              height: geom.canvasSize,
              mimeType: outputMime,
            });
          };
          reader.onerror = () => {
            reject(new Error('Failed to read compressed image output.'));
          };
          reader.readAsDataURL(blob);
        },
        outputMime,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image. The file may be corrupt or unreadable.'));
    };

    img.src = objectUrl;
  });
}

const PRIMARY_BUCKET = 'product-images';
const FALLBACK_BUCKET = 'products';

/**
 * Uploads an optimized product image blob to cloud storage (Supabase Storage).
 * Falls back gracefully in local development when Supabase Storage is not provisioned.
 */
export async function uploadProductImageToStorage(
  fileBlob: Blob,
  originalFileName: string = 'product.jpg',
  folder: string = 'catalog'
): Promise<ImageUploadResult> {
  // If Supabase is configured and connected
  if (isSupabaseConfigured && supabase) {
    try {
      const ext = originalFileName.split('.').pop()?.toLowerCase() || 'jpg';
      const cleanExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
      const prefix = folder === 'categories' ? 'cat' : 'prod';
      const uniqueFileName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${cleanExt}`;
      const filePath = `${folder}/${uniqueFileName}`;

      let targetBucket = PRIMARY_BUCKET;
      let uploadResult = await supabase.storage.from(targetBucket).upload(filePath, fileBlob, {
        contentType: fileBlob.type || 'image/jpeg',
        upsert: false,
      });

      // Try fallback bucket if primary bucket is not found
      if (
        uploadResult.error &&
        (uploadResult.error.message?.toLowerCase().includes('not found') ||
          uploadResult.error.message?.toLowerCase().includes('bucket'))
      ) {
        targetBucket = FALLBACK_BUCKET;
        uploadResult = await supabase.storage.from(targetBucket).upload(filePath, fileBlob, {
          contentType: fileBlob.type || 'image/jpeg',
          upsert: false,
        });
      }

      if (uploadResult.error) {
        console.warn('Supabase storage upload error:', uploadResult.error.message);
        // If storage bucket isn't provisioned or permissions error, fall back to optimized data URL
        // so local shopkeeper flow is not abruptly blocked
        return fallbackToDataUrl(fileBlob, `Storage notice: ${uploadResult.error.message}`);
      }

      const { data: publicUrlData } = supabase.storage.from(targetBucket).getPublicUrl(filePath);
      if (!publicUrlData || !publicUrlData.publicUrl) {
        return {
          success: false,
          error: 'Failed to retrieve public URL from cloud storage.',
          isCloudStorage: false,
        };
      }

      return {
        success: true,
        url: publicUrlData.publicUrl,
        isCloudStorage: true,
      };
    } catch (err: any) {
      console.warn('Storage upload exception:', err);
      return fallbackToDataUrl(fileBlob, err?.message);
    }
  }

  // Development / Preview mode fallback
  return fallbackToDataUrl(fileBlob);
}

function fallbackToDataUrl(fileBlob: Blob, warningNotice?: string): Promise<ImageUploadResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve({
        success: true,
        url: reader.result as string,
        isCloudStorage: false,
        error: warningNotice,
      });
    };
    reader.onerror = () => {
      resolve({
        success: false,
        error: 'Failed to process local image data.',
        isCloudStorage: false,
      });
    };
    reader.readAsDataURL(fileBlob);
  });
}

/**
 * Validates a manually entered image URL.
 */
export function validateImageUrl(url: string): { valid: boolean; error?: string; cleanUrl?: string } {
  if (!url || !url.trim()) {
    return { valid: false, error: 'Please enter an image URL.' };
  }

  const trimmed = url.trim();

  // Allow data URLs if they are valid image data
  if (trimmed.startsWith('data:image/')) {
    return { valid: true, cleanUrl: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Image URL must begin with http:// or https://' };
    }

    return { valid: true, cleanUrl: trimmed };
  } catch {
    return { valid: false, error: 'Please enter a valid web URL (e.g. https://example.com/product.jpg).' };
  }
}

/**
 * Uploads an optimized category image blob to cloud storage or local data URL.
 */
export async function uploadCategoryImageToStorage(
  fileBlob: Blob,
  originalFileName: string = 'category.jpg'
): Promise<ImageUploadResult> {
  return uploadProductImageToStorage(fileBlob, originalFileName, 'categories');
}

