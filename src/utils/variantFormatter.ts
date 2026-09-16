import { ProductVariant, UnitType } from '../types';

/**
 * Formats a variant's display label to guarantee that the pack size and unit (e.g., "500 G", "1 KG")
 * are always clearly visible to the user and shopkeeper, even if the stored packLabel is missing the unit.
 */
export function formatVariantPack(variant: {
  packLabel?: string;
  packSize: number;
  unit: UnitType | string;
}): string {
  if (!variant) return '';
  const unitStr = (variant.unit || '').trim();
  const sizeStr = variant.packSize ? String(variant.packSize) : '';
  const fallback = sizeStr && unitStr ? `${sizeStr} ${unitStr}` : sizeStr || unitStr || '1 Unit';

  if (!variant.packLabel || !variant.packLabel.trim()) {
    return fallback;
  }

  const label = variant.packLabel.trim();
  const lowerLabel = label.toLowerCase();
  const lowerUnit = unitStr.toLowerCase();

  // If unit is 'g', check for 'g', 'gm', 'gms', 'gram', 'grams'
  if (lowerUnit === 'g') {
    const hasG =
      /\b\d+\s*g\b/i.test(label) ||
      /\b\d+\s*gm\b/i.test(label) ||
      /\b\d+\s*gms\b/i.test(label) ||
      /\b\d+\s*gram/i.test(label) ||
      lowerLabel.includes(' g ') ||
      lowerLabel.endsWith(' g') ||
      lowerLabel.includes('g pack') ||
      lowerLabel.includes('g pouch');
    if (hasG) return label;
  } else if (lowerUnit && (lowerLabel.includes(lowerUnit) || lowerLabel.includes(unitStr))) {
    return label;
  }

  // If label is purely a numeric value (e.g. "500" or "250"), append the unit -> "500 G"
  if (/^\d+(\.\d+)?$/.test(label)) {
    return `${label} ${unitStr || 'G'}`;
  }

  // If label is a container word (e.g. "Pouch", "Jar", "Pack", "Box") without the unit, prefix with size & unit
  return `${sizeStr} ${unitStr} - ${label}`.trim();
}
