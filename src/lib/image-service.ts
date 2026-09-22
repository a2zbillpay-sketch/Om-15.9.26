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

/**
 * Resizes and compresses an image on-device using HTML5 Canvas before uploading.
 * High-resolution phone camera photos (typically 4000x3000px, 6-12MB) are scaled down to
 * max 1000px dimension and compressed to high-efficiency JPEG/WebP (~100-250KB),
 * preventing unnecessary mobile data usage and cloud storage waste.
 */
export async function optimizeProductImage(
  file: File | Blob,
  maxDimension: number = 1000,
  quality: number = 0.85
): Promise<ImageOptimizationResult> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid image file.');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width <= 0 || height <= 0) {
        return reject(new Error('Image has invalid dimensions.'));
      }

      // Calculate proportional dimensions
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return reject(new Error('Failed to initialize canvas context for compression.'));
      }

      // Use better smoothing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // Determine output mime
      const inputMime = file.type ? file.type.toLowerCase() : 'image/jpeg';
      const outputMime = inputMime === 'image/png' ? 'image/png' : 'image/jpeg';

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return reject(new Error('Failed to encode optimized image.'));
          }

          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({
              blob,
              dataUrl: reader.result as string,
              originalSize: file.size,
              optimizedSize: blob.size,
              width,
              height,
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
  originalFileName: string = 'product.jpg'
): Promise<ImageUploadResult> {
  // If Supabase is configured and connected
  if (isSupabaseConfigured && supabase) {
    try {
      const ext = originalFileName.split('.').pop()?.toLowerCase() || 'jpg';
      const cleanExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
      const uniqueFileName = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${cleanExt}`;
      const filePath = `catalog/${uniqueFileName}`;

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
