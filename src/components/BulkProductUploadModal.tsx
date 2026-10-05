import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search,
  ArrowRight,
  Database,
  HelpCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Product, Category, UnitType } from '../types';
import { normalizeAndValidateBarcode } from '../lib/product-service';

export interface BulkProductUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  existingProducts: Product[];
  onProductsImported: (newProducts: Omit<Product, 'id' | 'createdAt'>[]) => Promise<{
    successCount: number;
    failedCount: number;
    errors: string[];
  }>;
  onAddCategory?: (name: string) => Promise<Category | null>;
}

export interface ParsedProductRow {
  rowNumber: number;
  name: string;
  brand: string;
  categoryName: string;
  description: string;
  barcode: string | null;
  unit: UnitType;
  packSize: number;
  packLabel: string;
  purchasePrice: number;
  salePrice: number;
  discount: number;
  mrp: number;
  stockQuantity: number;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

const UNIT_SYNONYMS: Record<string, UnitType> = {
  kg: UnitType.KG,
  kilogram: UnitType.KG,
  kgs: UnitType.KG,
  kilo: UnitType.KG,
  g: UnitType.G,
  gm: UnitType.G,
  gms: UnitType.G,
  gram: UnitType.G,
  grams: UnitType.G,
  l: UnitType.LITER,
  ltr: UnitType.LITER,
  litre: UnitType.LITER,
  liter: UnitType.LITER,
  litres: UnitType.LITER,
  liters: UnitType.LITER,
  ml: UnitType.ML,
  milli: UnitType.ML,
  milliliter: UnitType.ML,
  box: UnitType.BOX,
  boxes: UnitType.BOX,
  pkt: UnitType.BOX,
  packet: UnitType.BOX,
  pack: UnitType.BOX,
  can: UnitType.CAN,
  tin: UnitType.CAN,
  katta: UnitType.KATTA,
  bag: UnitType.KATTA,
  sack: UnitType.KATTA,
  bora: UnitType.KATTA,
  nos: UnitType.NOS,
  no: UnitType.NOS,
  piece: UnitType.NOS,
  pc: UnitType.NOS,
  pcs: UnitType.NOS,
  item: UnitType.NOS,
  unit: UnitType.NOS,
};

export const BulkProductUploadModal: React.FC<BulkProductUploadModalProps> = ({
  isOpen,
  onClose,
  categories = [],
  existingProducts = [],
  onProductsImported,
  onAddCategory,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedProductRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<{
    successCount: number;
    failedCount: number;
    errors: string[];
  } | null>(null);

  const [filterTab, setFilterTab] = useState<'ALL' | 'VALID' | 'ERRORS'>('ALL');
  const [searchFilter, setSearchFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const safeExistingProducts = Array.isArray(existingProducts) ? existingProducts : [];
  const safeCategories = Array.isArray(categories) ? categories : [];

  // Build a set of existing non-empty barcodes for fast deduplication check
  const existingBarcodeMap = new Map<string, string>();
  safeExistingProducts.forEach((p) => {
    if (p && p.barcode) {
      const clean = String(p.barcode).trim();
      if (clean) existingBarcodeMap.set(clean, p.name || 'Existing Product');
    }
  });

  // Handle template file generation
  const handleDownloadSample = (format: 'xlsx' | 'csv') => {
    const sampleData = [
      {
        'Product Name': 'Fortune Sunlite Refined Sunflower Oil',
        Brand: 'Fortune',
        Category: 'Cooking Oils & Ghee',
        Description: '100% pure refined sunflower oil with vitamins A & D',
        Barcode: '8906007280015',
        Unit: '1 LITER',
        'Purchase Price': 120,
        'Sale Price': 135,
        Discount: 10,
        'Stock Quantity': 48,
      },
      {
        'Product Name': 'Royal Supreme Kolam Rice',
        Brand: 'Om Special',
        Category: 'Grains & Rice',
        Description: 'Aged aromatic steam kolam rice, clean wholesale pack',
        Barcode: '8906007280022',
        Unit: '25 KG Katta',
        'Purchase Price': 1300,
        'Sale Price': 1420,
        Discount: 8,
        'Stock Quantity': 25,
      },
      {
        'Product Name': 'Desi Toor Dal Laser Cleaned',
        Brand: 'Om Gold',
        Category: 'Dals & Pulses',
        Description: 'Unpolished high protein desi toor dal direct from Latur mandi',
        Barcode: '8906007280039',
        Unit: '1 KG',
        'Purchase Price': 140,
        'Sale Price': 158,
        Discount: 10,
        'Stock Quantity': 60,
      },
      {
        'Product Name': 'Chakki Fresh Wheat Atta',
        Brand: 'Aashirvaad',
        Category: 'Atta, Flours & Sooji',
        Description: '100% whole wheat flour with natural dietary fiber',
        Barcode: '8906007280046',
        Unit: '10 KG',
        'Purchase Price': 370,
        'Sale Price': 410,
        Discount: 7,
        'Stock Quantity': 30,
      },
      {
        'Product Name': 'Tata Salt Vacuum Evaporated',
        Brand: 'Tata',
        Category: 'Sugar, Salt & Jaggery',
        Description: 'Desh ka namak with guaranteed iodine enrichment',
        Barcode: '8906007280053',
        Unit: '1 KG',
        'Purchase Price': 20,
        'Sale Price': 25,
        Discount: 10,
        'Stock Quantity': 100,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');

    if (format === 'xlsx') {
      XLSX.writeFile(wb, 'Om_Distributors_Products_Template.xlsx');
    } else {
      XLSX.writeFile(wb, 'Om_Distributors_Products_Template.csv', { bookType: 'csv' });
    }
  };

  // Helper to extract value from row object matching various possible column headers
  const getCol = (row: Record<string, any>, possibleHeaders: string[]): any => {
    const keys = Object.keys(row);
    for (const h of possibleHeaders) {
      const target = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      const foundKey = keys.find(
        (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === target
      );
      if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
        return row[foundKey];
      }
    }
    return '';
  };

  // Parse raw Unit string into UnitType and packSize
  const parseUnitString = (rawUnit: string): { unit: UnitType; packSize: number; packLabel: string } => {
    const str = String(rawUnit || '').trim();
    if (!str) {
      return { unit: UnitType.NOS, packSize: 1, packLabel: '1 NOS' };
    }

    // Try extracting number and unit from strings like "25 KG", "500 G", "1 LTR", "25 KG Katta"
    const match = str.match(/^([\d.]+)\s*([a-zA-Z]+)(.*)$/);
    if (match) {
      const num = parseFloat(match[1]) || 1;
      const unitKey = match[2].toLowerCase();
      const matchedUnit = UNIT_SYNONYMS[unitKey] || UnitType.NOS;
      const label = `${num} ${matchedUnit}`;
      return { unit: matchedUnit, packSize: num, packLabel: label };
    }

    // If only word is provided (e.g. "KG", "LITER", "BOX")
    const cleanUnitKey = str.toLowerCase().replace(/[^a-z]/g, '');
    const matchedUnit = UNIT_SYNONYMS[cleanUnitKey] || UnitType.NOS;
    return { unit: matchedUnit, packSize: 1, packLabel: `1 ${matchedUnit}` };
  };

  // Process and validate uploaded file
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setIsParsing(true);
    setImportResult(null);

    try {
      const buffer = await selected.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (rawRows.length === 0) {
        setParsedRows([]);
        setIsParsing(false);
        return;
      }

      const fileBarcodeTracker = new Set<string>();
      const parsed: ParsedProductRow[] = [];

      rawRows.forEach((row, index) => {
        const rowNumber = index + 2; // Row 1 is header
        const rowErrors: string[] = [];
        const rowWarnings: string[] = [];

        // 1. Product Name (Required)
        const nameRaw = getCol(row, ['Product Name', 'Name', 'Title', 'Product', 'Item Name', 'Item']);
        const name = String(nameRaw || '').trim();
        if (!name) {
          rowErrors.push('Product Name is required.');
        }

        // 2. Brand (Optional)
        const brandRaw = getCol(row, ['Brand', 'Company', 'Manufacturer', 'Make']);
        const brand = String(brandRaw || '').trim();

        // 3. Category (Optional / Matched)
        const catRaw = getCol(row, ['Category', 'Category Name', 'Cat', 'Department']);
        const categoryName = String(catRaw || '').trim();

        // 4. Description (Optional)
        const descRaw = getCol(row, ['Description', 'Details', 'Desc', 'About']);
        const description = String(descRaw || '').trim();

        // 5. Unit & Pack Size
        const unitRaw = getCol(row, ['Unit', 'Unit Type', 'UOM', 'Pack Unit', 'Size']);
        const { unit, packSize, packLabel } = parseUnitString(String(unitRaw));

        // 6. Pricing: Sale Price & Purchase Price & Discount (NEVER map Purchase Price to MRP)
        // Allow decimal values such as ₹9.50, ₹9.5, ₹10.25 (never restrict Selling Price to whole numbers)
        const salePriceRaw = getCol(row, ['Sale Price', 'Selling Price', 'Sale Rate', 'Rate', 'Sell Price', 'Price']);
        const purchasePriceRaw = getCol(row, ['Purchase Price', 'Purchase Rate', 'Purchase Cost', 'Cost Price', 'Buy Price', 'Cost']);
        const discountRaw = getCol(row, ['Discount', 'Discount %', 'Discount Percent', 'Discount Amount', 'Discount Rate', 'Offer']);
        const mrpRaw = getCol(row, ['MRP', 'M.R.P.', 'Max Retail Price', 'Printed Price', 'List Price']);

        const cleanSalePrice = String(salePriceRaw ?? '').trim().replace(/,/g, '.');
        const salePriceMatch = cleanSalePrice.match(/[0-9]+(?:\.[0-9]+)?/);
        const salePrice = salePriceMatch ? parseFloat(salePriceMatch[0]) : 0;

        const cleanPurchasePrice = String(purchasePriceRaw ?? '').trim().replace(/,/g, '.');
        const purchasePriceMatch = cleanPurchasePrice.match(/[0-9]+(?:\.[0-9]+)?/);
        let purchasePrice = purchasePriceMatch ? parseFloat(purchasePriceMatch[0]) : 0;

        let discount = parseFloat(String(discountRaw).replace(/[^0-9.]/g, '')) || 0;
        let mrp = parseFloat(String(mrpRaw).replace(/[^0-9.]/g, '')) || 0;

        if (salePrice <= 0) {
          rowErrors.push('Sale Price must be a valid positive number (e.g. ₹9.50, ₹10.25).');
        }

        if (purchasePrice < 0) {
          rowErrors.push('Purchase Price cannot be negative.');
        }

        // Determine MRP: NEVER map Purchase Price to MRP!
        // If MRP is explicitly provided, use it; otherwise compute from sale price & discount, or default to sale price
        if (mrp <= 0) {
          if (discount > 0) {
            if (discount < 100) {
              mrp = Math.round((salePrice / (100 - discount)) * 100);
            } else {
              mrp = salePrice + discount;
            }
          } else {
            mrp = salePrice;
          }
        }

        // Ensure MRP is not less than Sale Price
        if (mrp < salePrice) {
          mrp = salePrice;
        }

        // If MRP was explicitly provided and discount was not, calculate discount percentage off MRP
        if (discount <= 0 && mrp > salePrice) {
          discount = Math.round(((mrp - salePrice) / mrp) * 100);
        }

        // 7. Stock Quantity
        const stockRaw = getCol(row, ['Stock Quantity', 'Stock', 'Quantity', 'Qty', 'Inventory', 'Initial Stock']);
        let stockQuantity = parseInt(String(stockRaw).replace(/[^0-9]/g, ''), 10);
        if (isNaN(stockQuantity) || stockQuantity < 0) {
          stockQuantity = 0;
        }

        // 8. Barcode Validation & Deduplication
        const barcodeRaw = getCol(row, ['Barcode', 'Bar Code', 'UPC', 'EAN', 'Code']);
        const { valid: isBarcodeValid, barcode, error: barcodeFormatError } = normalizeAndValidateBarcode(barcodeRaw);

        if (!isBarcodeValid) {
          rowErrors.push(barcodeFormatError || 'Invalid barcode format.');
        } else if (barcode) {
          // Check duplicate against existing products in store
          if (existingBarcodeMap.has(barcode)) {
            const existingName = existingBarcodeMap.get(barcode);
            rowErrors.push(`Duplicate Barcode: already used by "${existingName}".`);
          }
          // Check duplicate within the uploaded file itself
          else if (fileBarcodeTracker.has(barcode)) {
            rowErrors.push(`Duplicate Barcode: appears multiple times in uploaded file.`);
          } else {
            fileBarcodeTracker.add(barcode);
          }
        }

        parsed.push({
          rowNumber,
          name,
          brand,
          categoryName,
          description,
          barcode,
          unit,
          packSize,
          packLabel,
          purchasePrice,
          salePrice,
          discount,
          mrp,
          stockQuantity,
          isValid: rowErrors.length === 0,
          errors: rowErrors,
          warnings: rowWarnings,
        });
      });

      setParsedRows(parsed);
    } catch (err: any) {
      console.error('Failed to parse file:', err);
      alert('Failed to read file. Please ensure it is a valid .xlsx, .xls, or .csv document.');
    } finally {
      setIsParsing(false);
    }
  };

  const validRows = useMemo(() => parsedRows.filter((r) => r.isValid), [parsedRows]);
  const invalidRows = useMemo(() => parsedRows.filter((r) => !r.isValid), [parsedRows]);

  const displayedRows = useMemo(() => {
    let list = parsedRows;
    if (filterTab === 'VALID') list = validRows;
    if (filterTab === 'ERRORS') list = invalidRows;

    if (!searchFilter.trim()) return list;
    const q = searchFilter.toLowerCase();
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.brand.toLowerCase().includes(q) ||
        (r.barcode && r.barcode.toLowerCase().includes(q))
    );
  }, [parsedRows, validRows, invalidRows, filterTab, searchFilter]);

  // Execute bulk import
  const handleExecuteImport = async () => {
    if (validRows.length === 0) return;

    setIsImporting(true);
    setImportProgress(10);

    try {
      // 1. Prepare categories lookup map
      const categoryMap = new Map<string, string>();
      safeCategories.forEach((c) => {
        if (c && c.name) categoryMap.set(c.name.trim().toLowerCase(), c.id);
        if (c && c.id) categoryMap.set(c.id.trim().toLowerCase(), c.id);
      });

      // Default category fallback
      const defaultCategoryId = safeCategories[0]?.id || 'cat-general';

      // 2. Transform valid rows to Product objects
      const productsToCreate: Omit<Product, 'id' | 'createdAt'>[] = [];

      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];

        // Resolve category
        let categoryId = defaultCategoryId;
        if (row.categoryName) {
          const matchedId = categoryMap.get(row.categoryName.trim().toLowerCase());
          if (matchedId) {
            categoryId = matchedId;
          } else if (onAddCategory) {
            // Automatically add new category if handler exists
            try {
              const newCat = await onAddCategory(row.categoryName.trim());
              if (newCat) {
                categoryId = newCat.id;
                categoryMap.set(newCat.name.trim().toLowerCase(), newCat.id);
              }
            } catch {
              categoryId = defaultCategoryId;
            }
          }
        }

        const variantId = `var-bulk-${Date.now()}-${i}`;
        const trimmedName = row.name.trim();
        const trimmedBrand = row.brand ? row.brand.trim() : '';

        const newProd: Omit<Product, 'id' | 'createdAt'> = {
          name: trimmedName,
          brand: trimmedBrand,
          description: row.description?.trim() || `${trimmedName} - Premium Quality wholesale groceries.`,
          categoryId,
          barcode: row.barcode,
          purchasePrice: row.purchasePrice,
          discount: row.discount,
          isDiscountExcluded: row.discount <= 0,
          lowStockThreshold: 5,
          variants: [
            {
              id: variantId,
              productId: '',
              unit: row.unit,
              packSize: row.packSize,
              packLabel: row.packLabel,
              mrp: row.mrp,
              baseSellingPrice: row.salePrice,
              purchasePrice: row.purchasePrice,
              discount: row.discount,
              stockQuantity: row.stockQuantity,
              maxOrderLimit: 12,
              tieredPrices: [],
              lowStockThreshold: 5,
            },
          ],
        };

        productsToCreate.push(newProd);
        setImportProgress(Math.min(90, Math.round(((i + 1) / validRows.length) * 80) + 10));
      }

      // 3. Import through container action
      const result = await onProductsImported(productsToCreate);
      setImportProgress(100);
      setImportResult(result);
    } catch (err: any) {
      console.error('Bulk import failed:', err);
      setImportResult({
        successCount: 0,
        failedCount: validRows.length,
        errors: [err?.message || 'Unexpected error occurred during bulk product import.'],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setParsedRows([]);
    setImportResult(null);
    setFilterTab('ALL');
    setSearchFilter('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isOpen) return null;

  return (
    <div
      id="bulk-upload-modal-overlay"
      className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 z-50 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isImporting) {
          onClose();
        }
      }}
    >
      <div
        id="bulk-upload-modal-container"
        className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden border border-gray-200"
      >
        {/* Header */}
        <div className="bg-[#0F2C59] text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <FileSpreadsheet className="text-[#D4AF37]" size={22} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wide flex items-center gap-2">
                <span>Bulk Product Import</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-400/30">
                  Excel & CSV
                </span>
              </h2>
              <p className="text-xs text-gray-300 mt-0.5">
                Upload grocery products, barcode tags, purchase/sale rates, and stock quantities
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isImporting}
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-300 hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-gray-50/50">
          {/* Result Banner after Import */}
          {importResult && (
            <div
              className={`p-4 rounded-xl border ${
                importResult.successCount > 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-start gap-3">
                {importResult.successCount > 0 ? (
                  <CheckCircle2 size={24} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={24} className="text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <h3 className="font-extrabold text-sm sm:text-base">
                    {importResult.successCount > 0
                      ? `Import Completed: ${importResult.successCount} Products Added Successfully!`
                      : 'Import Failed'}
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">
                    {importResult.successCount > 0
                      ? `All valid products have been saved to your inventory with stock, barcodes, and wholesale price slabs.`
                      : 'No products were added. Please review the errors below and try again.'}
                  </p>

                  {importResult.errors.length > 0 && (
                    <div className="mt-3 bg-white/80 p-3 rounded-lg border border-rose-200 text-xs text-rose-800 space-y-1">
                      <div className="font-bold text-[11px] uppercase tracking-wide">
                        Issues Encountered ({importResult.errors.length}):
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {importResult.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                      {importResult.errors.length > 5 && (
                        <p className="text-[10px] text-gray-500 italic">
                          ...and {importResult.errors.length - 5} more issues.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        resetAll();
                        onClose();
                      }}
                      className="px-4 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-white text-xs font-extrabold rounded-xl shadow-xs transition"
                    >
                      Done & View Inventory
                    </button>
                    <button
                      type="button"
                      onClick={resetAll}
                      className="px-3.5 py-2 bg-white hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-300 transition"
                    >
                      Upload Another File
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Template Download & File Dropzone */}
          {!importResult && (
            <>
              {/* Template Download Prompt */}
              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg shrink-0 mt-0.5">
                    <Download size={16} />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-[#0F2C59] text-xs">Need the spreadsheet template?</h4>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Download our pre-formatted sample with columns: Product Name, Brand, Category, Description,
                      Barcode, Unit, Purchase Price, Sale Price, Discount, and Stock Quantity.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => handleDownloadSample('xlsx')}
                    className="flex-1 sm:flex-initial px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg transition flex items-center justify-center gap-1.5 shadow-2xs"
                    title="Download Excel spreadsheet template with sample items"
                  >
                    <FileSpreadsheet size={13} />
                    <span>Download Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadSample('csv')}
                    className="flex-1 sm:flex-initial px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 font-bold rounded-lg transition flex items-center justify-center gap-1.5"
                    title="Download CSV comma-separated template"
                  >
                    <Download size={13} />
                    <span>Download CSV</span>
                  </button>
                </div>
              </div>

              {/* Upload Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all ${
                  file
                    ? 'border-emerald-400 bg-emerald-50/30'
                    : 'border-gray-300 hover:border-[#0F2C59] bg-white hover:bg-blue-50/20'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div className="flex flex-col items-center justify-center">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-xs ${
                      file ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-[#0F2C59]'
                    }`}
                  >
                    <Upload size={24} />
                  </div>
                  {file ? (
                    <div>
                      <p className="font-extrabold text-sm text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {(file.size / 1024).toFixed(1)} KB • {parsedRows.length} rows parsed
                      </p>
                      <span className="inline-block mt-2 text-[11px] font-bold text-[#0F2C59] underline">
                        Click to choose a different file
                      </span>
                    </div>
                  ) : (
                    <div>
                      <p className="font-extrabold text-sm text-gray-800">
                        Click or drag your Excel (.xlsx, .xls) or CSV file here
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Automatic column detection and barcode duplication verification
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Parsed Data Preview & Validation Matrix */}
              {parsedRows.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
                  {/* Summary Bar */}
                  <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-gray-800 uppercase tracking-wide">
                        Validation Summary:
                      </span>
                      <button
                        type="button"
                        onClick={() => setFilterTab('ALL')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                          filterTab === 'ALL'
                            ? 'bg-[#0F2C59] text-white shadow-2xs'
                            : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}
                      >
                        All Rows ({parsedRows.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterTab('VALID')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-lg transition flex items-center gap-1 ${
                          filterTab === 'VALID'
                            ? 'bg-emerald-600 text-white shadow-2xs'
                            : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                        }`}
                      >
                        <CheckCircle2 size={12} />
                        <span>Valid ({validRows.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterTab('ERRORS')}
                        className={`px-2.5 py-1 text-xs font-bold rounded-lg transition flex items-center gap-1 ${
                          filterTab === 'ERRORS'
                            ? 'bg-rose-600 text-white shadow-2xs'
                            : 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-200'
                        }`}
                      >
                        <AlertCircle size={12} />
                        <span>Errors ({invalidRows.length})</span>
                      </button>
                    </div>

                    {/* Quick Search in Preview */}
                    <div className="relative w-full sm:w-60">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search parsed items..."
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs outline-none focus:border-[#0F2C59]"
                      />
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 text-gray-700 font-extrabold text-[11px] uppercase border-b border-gray-200 sticky top-0 z-10">
                          <th className="p-2.5 text-center w-12">Status</th>
                          <th className="p-2.5">Product Name</th>
                          <th className="p-2.5">Brand</th>
                          <th className="p-2.5">Category</th>
                          <th className="p-2.5">Unit / Pack</th>
                          <th className="p-2.5 text-right">Purchase Price</th>
                          <th className="p-2.5 text-right">Sale Price</th>
                          <th className="p-2.5 text-center">Discount</th>
                          <th className="p-2.5 text-center">Stock</th>
                          <th className="p-2.5">Barcode</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {displayedRows.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-8 text-center text-gray-400 text-xs">
                              No rows match the selected filter.
                            </td>
                          </tr>
                        ) : (
                          displayedRows.map((r) => (
                            <tr
                              key={r.rowNumber}
                              className={`hover:bg-gray-50/80 ${
                                !r.isValid ? 'bg-rose-50/40' : r.warnings.length > 0 ? 'bg-amber-50/30' : ''
                              }`}
                            >
                              <td className="p-2.5 text-center">
                                {r.isValid ? (
                                  <span
                                    className="inline-flex items-center text-emerald-600"
                                    title="Valid row ready for import"
                                  >
                                    <CheckCircle2 size={16} />
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center text-rose-600"
                                    title={r.errors.join(' | ')}
                                  >
                                    <AlertCircle size={16} />
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 font-bold text-gray-900 max-w-[200px]">
                                <div className="truncate">{r.name || '<Missing Name>'}</div>
                                {r.errors.length > 0 && (
                                  <div className="text-[10px] text-rose-600 font-normal leading-tight mt-0.5">
                                    {r.errors.join(', ')}
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 text-gray-600">{r.brand || '—'}</td>
                              <td className="p-2.5">
                                <span className="inline-block bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-semibold border border-gray-200">
                                  {r.categoryName || 'General'}
                                </span>
                              </td>
                              <td className="p-2.5 text-gray-700 font-mono font-medium">{r.packLabel}</td>
                              <td className="p-2.5 text-right font-mono text-gray-700 font-semibold">
                                ₹{Number.isInteger(r.purchasePrice) ? r.purchasePrice : r.purchasePrice.toFixed(2)}
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                                ₹{Number.isInteger(r.salePrice) ? r.salePrice : r.salePrice.toFixed(2)}
                              </td>
                              <td className="p-2.5 text-center font-mono">
                                {r.discount > 0 ? (
                                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-emerald-300">
                                    {r.discount}%
                                  </span>
                                ) : (
                                  <span className="text-gray-400 text-[10px]">0%</span>
                                )}
                              </td>
                              <td className="p-2.5 text-center font-mono font-bold text-gray-800">
                                {r.stockQuantity}
                              </td>
                              <td className="p-2.5 font-mono text-[11px] text-gray-700">
                                {r.barcode ? (
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                    {r.barcode}
                                  </span>
                                ) : (
                                  <span className="text-gray-400 text-[10px]">None</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer / Actions */}
        {!importResult && (
          <div className="bg-white px-5 py-3.5 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-gray-500 text-center sm:text-left">
              {parsedRows.length > 0 ? (
                <span>
                  Ready to import <strong className="text-emerald-700 font-black">{validRows.length}</strong> valid{' '}
                  {validRows.length === 1 ? 'product' : 'products'}
                  {invalidRows.length > 0 && (
                    <span className="text-rose-600 ml-1">
                      ({invalidRows.length} will be skipped due to validation errors)
                    </span>
                  )}
                </span>
              ) : (
                <span>Upload an Excel or CSV file to preview and validate products.</span>
              )}
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                type="button"
                disabled={isImporting}
                onClick={onClose}
                className="flex-1 sm:flex-initial px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="execute-bulk-import-btn"
                disabled={validRows.length === 0 || isImporting}
                onClick={handleExecuteImport}
                className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isImporting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Importing ({importProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <Database size={14} />
                    <span>Import {validRows.length} Products</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
