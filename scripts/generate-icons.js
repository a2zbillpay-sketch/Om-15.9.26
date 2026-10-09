import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const publicDir = path.join(process.cwd(), 'public');
const iconsDir = path.join(publicDir, 'icons');
const logoPath = path.join(publicDir, 'logo.jpg');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

if (!fs.existsSync(logoPath)) {
  console.error('ERROR: Official logo not found at:', logoPath);
  process.exit(1);
}

try {
  console.log('Regenerating PWA icons directly from official logo.jpg...');

  // Standard PWA icons (192x192 and 512x512)
  execSync(`convert "${logoPath}" -filter Lanczos -quality 100 -resize 192x192 "${path.join(iconsDir, 'icon-192x192.png')}"`);
  execSync(`convert "${logoPath}" -filter Lanczos -quality 100 -resize 512x512 "${path.join(iconsDir, 'icon-512x512.png')}"`);

  // Maskable icons (with safe-zone margin derived directly from logo.jpg)
  execSync(`convert "${logoPath}" -resize 512x512 -blur 0x16 /tmp/maskable-bg.png`);
  execSync(`convert "${logoPath}" -quality 100 -resize 410x410 /tmp/logo-410.png`);
  execSync(`composite -gravity center /tmp/logo-410.png /tmp/maskable-bg.png "${path.join(iconsDir, 'icon-maskable-512x512.png')}"`);
  execSync(`convert "${path.join(iconsDir, 'icon-maskable-512x512.png')}" -resize 192x192 "${path.join(iconsDir, 'icon-maskable-192x192.png')}"`);

  // Apple touch icon and root icons
  execSync(`convert "${logoPath}" -filter Lanczos -quality 100 -resize 180x180 "${path.join(publicDir, 'apple-touch-icon.png')}"`);
  execSync(`convert "${logoPath}" -filter Lanczos -quality 100 -resize 180x180 "${path.join(publicDir, 'apple-touch-icon-180x180.png')}"`);
  execSync(`convert "${logoPath}" -filter Lanczos -quality 100 -resize 192x192 "${path.join(publicDir, 'pwa-192x192.png')}"`);
  execSync(`convert "${logoPath}" -filter Lanczos -quality 100 -resize 512x512 "${path.join(publicDir, 'pwa-512x512.png')}"`);
  execSync(`convert "${logoPath}" -resize 32x32 "${path.join(publicDir, 'favicon-32x32.png')}"`);
  execSync(`convert "${logoPath}" -resize 16x16 "${path.join(publicDir, 'favicon-16x16.png')}"`);
  execSync(`convert "${logoPath}" -define icon:auto-resize=64,32,16 "${path.join(publicDir, 'favicon.ico')}"`);

  console.log('Successfully regenerated all icons directly from official logo.jpg!');
} catch (err) {
  console.error('Error generating icons:', err);
  process.exit(1);
}
