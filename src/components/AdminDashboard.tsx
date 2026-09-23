import React, { useState } from 'react';
import {
  Package,
  Layers,
  Settings,
  TrendingUp,
  Clock,
  CheckCircle,
  Truck,
  Plus,
  Edit2,
  Edit3,
  Trash2,
  Search,
  Filter,
  DollarSign,
  AlertCircle,
  Upload,
  Copy,
  X,
  Info,
  Sparkles,
  Check,
  ShoppingBag,
  Users,
  RefreshCw,
  Database,
  Scan,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  Boxes,
  Banknote,
  ZoomIn,
  Tag,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Order, OrderStatus, PaymentMethod, Product, ProductVariant, TieredPrice, UnitType, Role } from '../types';
import { AdminSettingsControl } from './AdminSettingsControl';
import { CategoryManagement } from './CategoryManagement';
import { LogoUploadModal } from './LogoUploadModal';
import { EditProductModal } from './EditProductModal';
import { AddVariantModal } from './AddVariantModal';
import { StockAdjustmentModal } from './StockAdjustmentModal';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { BarcodeLookupBanner } from './BarcodeLookupBanner';
import { CodCollectionModal } from './CodCollectionModal';
import { ProductImageUploader } from './ProductImageUploader';
import { ImageLightboxModal } from './ImageLightboxModal';
import { formatVariantPack } from '../utils/variantFormatter';
import {
  normalizeAndValidateBarcode,
  lookupProductByBarcode,
  BarcodeLookupMatchResult,
} from '../lib/product-service';

export interface VariantFormRow {
  id: string;
  packSize: string;
  unit: UnitType | '';
  packLabel: string;
  mrp: string;
  baseSellingPrice: string;
  stockQuantity: string;
  maxOrderLimit: string;
  wholesaleMinQty: string;
  wholesaleMaxQty: string;
  wholesalePrice: string;
}

const COMMON_PACK_PRESETS: { label: string; size: string; unit: UnitType }[] = [
  { label: '250 G', size: '250', unit: UnitType.G },
  { label: '500 G', size: '500', unit: UnitType.G },
  { label: '1 KG', size: '1', unit: UnitType.KG },
  { label: '2 KG', size: '2', unit: UnitType.KG },
  { label: '5 KG', size: '5', unit: UnitType.KG },
  { label: '10 KG', size: '10', unit: UnitType.KG },
  { label: '25 KG Katta', size: '25', unit: UnitType.KATTA },
  { label: '50 KG Katta', size: '50', unit: UnitType.KATTA },
  { label: '1 Liter', size: '1', unit: UnitType.LITER },
  { label: '5 L Can', size: '5', unit: UnitType.CAN },
  { label: '1 Box / Ctn', size: '1', unit: UnitType.BOX },
  { label: '1 Unit (NOS)', size: '1', unit: UnitType.NOS },
];

const createBlankVariantRow = (customSize = '', customUnit: UnitType | '' = ''): VariantFormRow => ({
  id: `var-new-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
  packSize: customSize,
  unit: customUnit,
  packLabel: customSize && customUnit ? `${customSize} ${customUnit}` : '',
  mrp: '',
  baseSellingPrice: '',
  stockQuantity: '',
  maxOrderLimit: '',
  wholesaleMinQty: '',
  wholesaleMaxQty: '',
  wholesalePrice: '',
});

export const AdminDashboard: React.FC = () => {
  const {
    orders,
    products,
    categories,
    updateOrderStatus,
    addProduct,
    updateProduct,
    deleteProduct,
    settings,
    setActiveRole,
    users,
    isSupabaseConfigured,
    refreshOrders,
    recordCodCollection,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'ORDERS' | 'INVENTORY' | 'CATEGORIES' | 'SETTINGS' | 'CUSTOMERS'>('ORDERS');
  const [orderFilter, setOrderFilter] = useState<string>('ALL');
  const [inventorySearch, setInventorySearch] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const [codCollectingOrder, setCodCollectingOrder] = useState<Order | null>(null);

  // Add product modal state
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  // Edit individual product state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  // Add variant to individual product state
  const [addingVariantProduct, setAddingVariantProduct] = useState<Product | null>(null);
  // Barcode-assisted stock management modal state
  const [stockAdjustProduct, setStockAdjustProduct] = useState<Product | null>(null);
  // Fullscreen photo preview lightbox state
  const [zoomImageProduct, setZoomImageProduct] = useState<Product | null>(null);

  const handleSaveEditProduct = (productId: string, updates: Partial<Product>) => {
    updateProduct(productId, updates);
  };

  const handleAddVariantToProduct = (productId: string, newVariant: ProductVariant) => {
    const target = products.find((p) => p.id === productId);
    if (!target) return;
    setAddingVariantProduct(null);
    updateProduct(productId, {
      variants: [...target.variants, newVariant],
    });
  };

  const handleSaveStock = async (
    productId: string,
    updatedVariants: ProductVariant[]
  ): Promise<{ success: boolean; error?: string }> => {
    if (
      barcodeLookupResult &&
      (barcodeLookupResult.status === 'duplicate_found' || barcodeLookupResult.status === 'not_found')
    ) {
      return { success: false, error: 'Cannot modify stock: duplicate or invalid barcode conflict detected.' };
    }

    const res = await updateProduct(productId, { variants: updatedVariants });
    if (res && res.success) {
      if (editingProduct && editingProduct.id === productId) {
        setEditingProduct({ ...editingProduct, variants: updatedVariants });
      }
      if (barcodeLookupResult && barcodeLookupResult.product && barcodeLookupResult.product.id === productId) {
        setBarcodeLookupResult({
          ...barcodeLookupResult,
          product: { ...barcodeLookupResult.product, variants: updatedVariants },
        });
      }
      return { success: true };
    }
    return { success: false, error: res?.error || 'Failed to update stock in inventory.' };
  };

  // Main product form state - starts completely BLANK without hardcoded defaults
  const [newProductData, setNewProductData] = useState({
    name: '',
    brand: '',
    description: '',
    categoryId: '',
    imageUrl: '',
    barcode: '',
    isDiscountExcluded: false,
  });

  // Multiple variants state for the new product - always starts with a 100% BLANK row
  const [variantRows, setVariantRows] = useState<VariantFormRow[]>([createBlankVariantRow()]);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);
  const [isAddBarcodeScannerOpen, setIsAddBarcodeScannerOpen] = useState(false);
  const [isInventorySearchScannerOpen, setIsInventorySearchScannerOpen] = useState(false);

  // Barcode-Based Product Lookup & Inventory Workflow states
  const [barcodeLookupResult, setBarcodeLookupResult] = useState<BarcodeLookupMatchResult | null>(null);
  const [manualBarcodeInput, setManualBarcodeInput] = useState('');
  const [barcodeLookupError, setBarcodeLookupError] = useState<string | null>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const [onlyShowLookupMatched, setOnlyShowLookupMatched] = useState(false);
  const [isInventoryLookupScannerOpen, setIsInventoryLookupScannerOpen] = useState(false);

  const handleOpenAddProductModal = () => {
    setNewProductData({
      name: '',
      brand: '',
      description: '',
      categoryId: '',
      imageUrl: '',
      barcode: '',
      isDiscountExcluded: false,
    });
    // Table always opens completely blank with 0 pre-filled values
    setVariantRows([createBlankVariantRow()]);
    setFormValidationError(null);
    setIsAddProductModalOpen(true);
  };

  const handleOpenAddProductModalWithBarcode = (initialBarcode: string) => {
    setNewProductData({
      name: '',
      brand: '',
      description: '',
      categoryId: '',
      imageUrl: '',
      barcode: initialBarcode,
      isDiscountExcluded: false,
    });
    setVariantRows([createBlankVariantRow()]);
    setFormValidationError(null);
    setBarcodeLookupResult(null);
    setBarcodeLookupError(null);
    setIsAddProductModalOpen(true);
  };

  const handleBarcodeLookup = (rawBarcode: string) => {
    setBarcodeLookupError(null);
    const lookupRes = lookupProductByBarcode(rawBarcode, products);

    if (lookupRes.status === 'empty') {
      setBarcodeLookupError('Please enter or scan a barcode.');
      return;
    }

    if (lookupRes.status === 'invalid') {
      setBarcodeLookupError(lookupRes.error || 'Invalid barcode format.');
      setBarcodeLookupResult(lookupRes);
      return;
    }

    setBarcodeLookupResult(lookupRes);

    if (lookupRes.status === 'found' && lookupRes.product) {
      setHighlightedProductId(lookupRes.product.id);
      // Smooth scroll to product card
      setTimeout(() => {
        const el = document.getElementById(`inventory-product-${lookupRes.product!.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 120);
    } else {
      setHighlightedProductId(null);
      setOnlyShowLookupMatched(false);
    }
  };

  const handleClearBarcodeLookup = () => {
    setBarcodeLookupResult(null);
    setHighlightedProductId(null);
    setBarcodeLookupError(null);
    setOnlyShowLookupMatched(false);
    setManualBarcodeInput('');
  };

  const handleCloseAddProductModal = () => {
    setNewProductData({
      name: '',
      brand: '',
      description: '',
      categoryId: '',
      imageUrl: '',
      barcode: '',
      isDiscountExcluded: false,
    });
    setVariantRows([createBlankVariantRow()]);
    setFormValidationError(null);
    setIsAddProductModalOpen(false);
  };

  // Option 1: Add a completely blank variant row
  const handleAddBlankVariantRow = () => {
    setVariantRows((prev) => [...prev, createBlankVariantRow()]);
  };

  // Option 2: Add via Quick Preset (pack size & unit pre-filled, all prices blank for shopkeeper)
  const handleAddPresetVariantRow = (size: string, unit: UnitType) => {
    setVariantRows((prev) => [...prev, createBlankVariantRow(size, unit)]);
  };

  // Option 3: Duplicate an existing variant row
  const handleDuplicateVariantRow = (index: number) => {
    const target = variantRows[index];
    if (!target) return;
    const duplicated: VariantFormRow = {
      ...target,
      id: `var-new-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
    setVariantRows((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, duplicated);
      return next;
    });
  };

  // Option 4: Remove a variant row
  const handleRemoveVariantRow = (index: number) => {
    setVariantRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Keep at least one blank row
      if (next.length === 0) {
        return [createBlankVariantRow()];
      }
      return next;
    });
  };

  // Update a specific cell in a variant row
  const handleUpdateVariantRow = (
    index: number,
    field: keyof VariantFormRow,
    value: string
  ) => {
    setVariantRows((prev) => {
      const next = [...prev];
      const current = next[index];
      const updated = { ...current, [field]: value };

      // Auto-update pack label hint if user hasn't explicitly customized it
      if (field === 'packSize' || field === 'unit') {
        const size = field === 'packSize' ? value : current.packSize;
        const u = field === 'unit' ? value : current.unit;
        if (!current.packLabel || current.packLabel === `${current.packSize} ${current.unit}`.trim()) {
          updated.packLabel = size && u ? `${size} ${u}` : '';
        }
      }

      next[index] = updated;
      return next;
    });
  };

  // KPI Calculations
  const totalRevenue = orders
    .filter((o) => o.status !== OrderStatus.CANCELLED)
    .reduce((sum, o) => sum + o.finalAmount, 0);

  const pendingOrdersCount = orders.filter(
    (o) =>
      o.status === OrderStatus.ORDER_PENDING ||
      o.status === OrderStatus.ORDER_ACCEPTED ||
      o.status === OrderStatus.PACKING_IN_PROGRESS
  ).length;

  const deliveredCount = orders.filter((o) => o.status === OrderStatus.DELIVERED).length;

  const customerUsers = users.filter((u) => u.role === Role.CUSTOMER);

  const lowStockCount = products.reduce(
    (acc, p) => acc + p.variants.filter((v) => v.stockQuantity <= 10).length,
    0
  );

  const filteredOrders = orders.filter((o) => {
    if (orderFilter === 'ALL') return true;
    return o.status === orderFilter;
  });

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(inventorySearch.toLowerCase())) ||
      (p.barcode && p.barcode.toLowerCase().includes(inventorySearch.toLowerCase()))
  );

  const displayedProducts =
    onlyShowLookupMatched && barcodeLookupResult?.status === 'found' && barcodeLookupResult.product
      ? [barcodeLookupResult.product]
      : filteredProducts;

  const newBarcodeConflict = newProductData.barcode.trim()
    ? products.find(
        (p) => p.barcode && p.barcode.trim().toLowerCase() === newProductData.barcode.trim().toLowerCase()
      )
    : null;

  const filteredCustomers = customerUsers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.phone.includes(customerSearch)
  );

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormValidationError(null);

    const trimmedName = newProductData.name.trim();
    if (!trimmedName) {
      setFormValidationError('Please enter product name.');
      return;
    }

    const trimmedBrand = newProductData.brand ? newProductData.brand.trim() : '';

    if (!newProductData.categoryId) {
      setFormValidationError('Please select a category.');
      return;
    }

    let validatedBarcode: string | undefined = undefined;
    if (newProductData.barcode.trim()) {
      const barcodeValidation = normalizeAndValidateBarcode(newProductData.barcode);
      if (!barcodeValidation.valid) {
        setFormValidationError(barcodeValidation.error || 'Invalid barcode format.');
        return;
      }
      const conflict = products.find(
        (p) => p.barcode && p.barcode.trim().toLowerCase() === barcodeValidation.barcode?.toLowerCase()
      );
      if (conflict) {
        setFormValidationError(
          `Barcode "${barcodeValidation.barcode}" is already assigned to "${conflict.name}"${conflict.brand ? ` (${conflict.brand})` : ''}. Barcodes must be unique.`
        );
        return;
      }
      validatedBarcode = barcodeValidation.barcode || undefined;
    }

    if (variantRows.length === 0) {
      setFormValidationError('Please add at least one Pack Variant.');
      return;
    }

    // Validate each variant row strictly without substituting any default values
    for (let i = 0; i < variantRows.length; i++) {
      const row = variantRows[i];
      const rowNum = i + 1;

      if (!row.packSize || isNaN(Number(row.packSize)) || Number(row.packSize) <= 0) {
        setFormValidationError(`Variant #${rowNum}: Please enter pack size.`);
        return;
      }

      if (!row.unit) {
        setFormValidationError(`Variant #${rowNum}: Please select unit.`);
        return;
      }

      if (!row.mrp || isNaN(Number(row.mrp)) || Number(row.mrp) <= 0) {
        setFormValidationError(`Variant #${rowNum}: Please enter MRP.`);
        return;
      }

      if (!row.baseSellingPrice || isNaN(Number(row.baseSellingPrice)) || Number(row.baseSellingPrice) <= 0) {
        setFormValidationError(`Variant #${rowNum}: Please enter selling price.`);
        return;
      }

      if (Number(row.baseSellingPrice) > Number(row.mrp)) {
        setFormValidationError(`Variant #${rowNum}: Base Selling Price (₹${row.baseSellingPrice}) cannot exceed MRP (₹${row.mrp}).`);
        return;
      }

      // Wholesale validation if fields are provided
      const hasWholesaleMin = Boolean(row.wholesaleMinQty && Number(row.wholesaleMinQty) > 0);
      const hasWholesalePrice = Boolean(row.wholesalePrice && Number(row.wholesalePrice) > 0);

      if (hasWholesalePrice && !hasWholesaleMin) {
        setFormValidationError(`Variant #${rowNum}: Please enter Wholesale Minimum Quantity for bulk pricing.`);
        return;
      }

      if (hasWholesaleMin && !hasWholesalePrice) {
        setFormValidationError(`Variant #${rowNum}: Please enter Wholesale Price for bulk quantity.`);
        return;
      }

      if (hasWholesaleMin && hasWholesalePrice) {
        if (Number(row.wholesalePrice) > Number(row.baseSellingPrice)) {
          setFormValidationError(`Variant #${rowNum}: Wholesale Price (₹${row.wholesalePrice}) cannot exceed Base Selling Price (₹${row.baseSellingPrice}).`);
          return;
        }
        if (row.wholesaleMaxQty && Number(row.wholesaleMaxQty) <= Number(row.wholesaleMinQty)) {
          setFormValidationError(`Variant #${rowNum}: Wholesale Maximum Quantity must be greater than Minimum Quantity.`);
          return;
        }
      }
    }

    // All valid! Construct product with variants
    const productId = `prod-${Date.now()}`;
    const constructedVariants: ProductVariant[] = variantRows.map((row, idx) => {
      const variantId = `var-${productId}-${idx}-${Date.now()}`;
      const pSize = Number(row.packSize);
      const u = row.unit as UnitType;
      const pLabel = formatVariantPack({
        packLabel: row.packLabel.trim() || undefined,
        packSize: pSize,
        unit: u,
      });

      const tieredPrices: TieredPrice[] =
        row.wholesaleMinQty && row.wholesalePrice && Number(row.wholesalePrice) > 0
          ? [
              {
                id: `tp-${Date.now()}-${idx}`,
                variantId,
                minQty: Number(row.wholesaleMinQty),
                maxQty: row.wholesaleMaxQty ? Number(row.wholesaleMaxQty) : 9999,
                unitPrice: Number(row.wholesalePrice),
              },
            ]
          : [];

      return {
        id: variantId,
        productId: '',
        unit: u,
        packSize: pSize,
        packLabel: pLabel,
        mrp: Number(row.mrp),
        baseSellingPrice: Number(row.baseSellingPrice),
        stockQuantity: row.stockQuantity ? Number(row.stockQuantity) : 0,
        maxOrderLimit: row.maxOrderLimit ? Number(row.maxOrderLimit) : 12,
        tieredPrices,
      };
    });

    const product = {
      name: trimmedName,
      brand: trimmedBrand,
      description: newProductData.description.trim(),
      categoryId: newProductData.categoryId,
      imageUrl: newProductData.imageUrl.trim() || undefined,
      barcode: validatedBarcode,
      isDiscountExcluded: newProductData.isDiscountExcluded,
      variants: constructedVariants,
    };

    setIsSubmittingProduct(true);
    try {
      const result = await addProduct(product);
      if (!result.success) {
        setFormValidationError(result.error || 'Failed to save product to central database.');
        return;
      }
      handleCloseAddProductModal();
    } catch (err: any) {
      setFormValidationError(err?.message || 'An unexpected error occurred while saving.');
    } finally {
      setIsSubmittingProduct(false);
    }
  };

  return (
    <div id="admin-dashboard-page" className="min-h-screen bg-gray-100 py-6 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Portal Header */}
        <div className="bg-[#0F2C59] text-white p-6 rounded-2xl shadow-md border-b-4 border-[#D4AF37] flex flex-wrap justify-between items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-[#D4AF37] text-[#0F2C59] font-black text-xs px-2.5 py-0.5 rounded">
                ADMIN ACCESS
              </span>
              <h1 className="text-xl font-black tracking-wide text-white">
                Om Distributors Management Center
              </h1>
            </div>
            <p className="text-xs text-gray-300 mt-1">
              Wholesale fulfillment pipeline, live tiered pricing, stock control & engine variables
            </p>
          </div>

          {/* Tab Selector & Logo Quick Action */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveRole(Role.CUSTOMER)}
              className="px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold shadow-sm"
              title="Return to customer store view"
            >
              <ShoppingBag size={13} className="text-[#FF6B00]" />
              <span>Back to Store</span>
            </button>

            <button
              onClick={() => setIsLogoModalOpen(true)}
              className="px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition bg-[#D4AF37]/20 hover:bg-[#D4AF37]/30 text-[#D4AF37] border border-[#D4AF37]/40 text-xs font-black shadow-sm"
              title="Upload your authentic logo file without alterations"
            >
              <Upload size={13} />
              <span>Upload Logo As-Is</span>
            </button>

            <div className="flex flex-wrap items-center bg-[#0a1e3d] p-1 rounded-xl border border-white/10 text-xs font-bold gap-1">
              <button
                onClick={() => setActiveTab('ORDERS')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'ORDERS' ? 'bg-[#FF6B00] text-white shadow' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Package size={14} />
                <span>Orders ({orders.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('INVENTORY')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'INVENTORY' ? 'bg-[#FF6B00] text-white shadow' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Layers size={14} />
                <span>Inventory</span>
              </button>
              <button
                id="tab-categories-btn"
                onClick={() => setActiveTab('CATEGORIES')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'CATEGORIES' ? 'bg-[#FF6B00] text-white shadow' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Tag size={14} />
                <span>Categories ({categories.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('CUSTOMERS')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'CUSTOMERS' ? 'bg-[#FF6B00] text-white shadow' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Users size={14} />
                <span>Customers ({customerUsers.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('SETTINGS')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'SETTINGS' ? 'bg-[#D4AF37] text-[#0F2C59] shadow font-black' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
              <button
                onClick={async () => {
                  setIsRefreshing(true);
                  await refreshOrders();
                  setTimeout(() => setIsRefreshing(false), 500);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition flex items-center gap-1 text-[11px]"
                title="Synchronize Orders with Cloud"
              >
                <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-[#D4AF37]' : ''} />
                <span className="hidden sm:inline">Sync</span>
              </button>
            </div>
          </div>
        </div>

        {/* Top KPI Cards - 6 Key Health Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold text-gray-500 uppercase truncate">Gross Sales</div>
            <div className="text-xl font-black text-[#0F2C59] mt-1">₹{totalRevenue.toLocaleString('en-IN')}</div>
            <div className="text-[9px] text-emerald-600 font-bold mt-1 flex items-center gap-0.5 truncate">
              <TrendingUp size={10} />
              <span>All Active</span>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold text-gray-500 uppercase truncate">Pending Packing</div>
            <div className="text-xl font-black text-[#FF6B00] mt-1">{pendingOrdersCount}</div>
            <div className="text-[9px] text-gray-500 mt-1 truncate">In fulfillment queue</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold text-gray-500 uppercase truncate">Delivered Orders</div>
            <div className="text-xl font-black text-emerald-700 mt-1">{deliveredCount}</div>
            <div className="text-[9px] text-gray-500 mt-1 truncate">Completed</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold text-gray-500 uppercase truncate">Catalog Products</div>
            <div className="text-xl font-black text-purple-700 mt-1">{products.length}</div>
            <div className="text-[9px] text-gray-500 mt-1 truncate">Across {categories.length} categories</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold text-gray-500 uppercase truncate">Registered Customers</div>
            <div className="text-xl font-black text-blue-700 mt-1">{customerUsers.length}</div>
            <div className="text-[9px] text-gray-500 mt-1 truncate">Verified accounts</div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <div className="text-[10px] font-bold text-gray-500 uppercase truncate">Low Stock Packs</div>
            <div className={`text-xl font-black mt-1 ${lowStockCount > 0 ? 'text-rose-600' : 'text-gray-700'}`}>
              {lowStockCount}
            </div>
            <div className="text-[9px] text-gray-500 mt-1 truncate">&le; 10 units remaining</div>
          </div>
        </div>

        {/* TAB 1: ORDERS FULFILLMENT PIPELINE */}
        {activeTab === 'ORDERS' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-base font-extrabold text-[#0F2C59]">Order Fulfillment Operations</h2>
                <p className="text-xs text-gray-500">Update fulfillment stage from acceptance to doorstep delivery</p>
              </div>

              {/* Status Filters */}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {['ALL', 'ORDER_ACCEPTED', 'PACKING_IN_PROGRESS', 'READY_FOR_DELIVERY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED'].map(
                  (status) => (
                    <button
                      key={status}
                      onClick={() => setOrderFilter(status)}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                        orderFilter === status
                          ? 'bg-[#0F2C59] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {status.replace(/_/g, ' ')}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Orders Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-700">
                <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-3">Order ID</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Payment</th>
                    <th className="p-3">Items</th>
                    <th className="p-3">Total</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Advance Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-500 font-medium">
                        No orders match the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50">
                        <td className="p-3 font-mono font-bold text-[#0F2C59]">
                          #{order.orderNumber}
                          <div className="text-[10px] text-gray-400 font-normal">
                            {new Date(order.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-gray-900">{order.userName}</div>
                          <div className="text-[10px] text-gray-500 font-mono">+91 {order.userPhone}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1">
                            <span
                              className={`inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded text-[10px] font-bold ${
                                order.paymentMethod === PaymentMethod.ADVANCE_ONLINE
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {order.paymentMethod === PaymentMethod.ADVANCE_ONLINE ? 'UPI Advance' : 'COD'}
                            </span>
                            {order.paymentMethod === PaymentMethod.COD && (
                              <div className="text-[10px] space-y-0.5">
                                {order.codCollectedAmount !== undefined ? (
                                  order.codCollectedAmount === order.finalAmount ? (
                                    <span className="text-emerald-700 font-bold block">
                                      Full: ₹{order.codCollectedAmount}
                                    </span>
                                  ) : (
                                    <div className="leading-tight">
                                      <span className="text-amber-800 font-bold block">
                                        Partial: ₹{order.codCollectedAmount}
                                      </span>
                                      <span className="text-red-600 font-semibold block text-[9px]">
                                        Short: ₹{order.finalAmount - order.codCollectedAmount}
                                      </span>
                                    </div>
                                  )
                                ) : (
                                  <span className="text-gray-400 font-medium block">Collection Pending</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setCodCollectingOrder(order)}
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-[#0F2C59] hover:text-[#FF6B00] transition cursor-pointer"
                                  title="Record or Adjust COD Collection"
                                >
                                  <Banknote size={11} />
                                  <span>{order.codCollectedAmount !== undefined ? 'Adjust COD' : 'Collect COD'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="font-medium text-gray-800">
                            {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                          </span>
                          <div className="text-[10px] text-gray-500 truncate max-w-[150px]">
                            {order.items.map((i) => i.productName).join(', ')}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="font-black text-gray-900">₹{order.finalAmount}</div>
                          {order.paymentMethod === PaymentMethod.COD && order.codCollectedAmount !== undefined && (
                            <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                              Dep: <span className="font-bold text-[#0F2C59]">₹{order.codCollectedAmount}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              order.status === OrderStatus.CANCELLED
                                ? 'bg-red-100 text-red-800'
                                : order.status === OrderStatus.DELIVERED
                                ? 'bg-emerald-100 text-emerald-800'
                                : order.status === OrderStatus.ON_THE_WAY
                                ? 'bg-blue-100 text-blue-800'
                                : order.status === OrderStatus.READY_FOR_DELIVERY
                                ? 'bg-purple-100 text-purple-800'
                                : order.status === OrderStatus.PACKING_IN_PROGRESS
                                ? 'bg-amber-100 text-amber-800'
                                : order.status === OrderStatus.ORDER_ACCEPTED
                                ? 'bg-[#FF6B00]/15 text-[#FF6B00]'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {order.status === OrderStatus.ORDER_PENDING
                              ? 'Order Pending'
                              : order.status === OrderStatus.ORDER_ACCEPTED
                              ? 'Order Accepted'
                              : order.status === OrderStatus.PACKING_IN_PROGRESS
                              ? 'Packing'
                              : order.status === OrderStatus.READY_FOR_DELIVERY
                              ? 'Ready'
                              : order.status === OrderStatus.ON_THE_WAY
                              ? 'On The Way'
                              : order.status === OrderStatus.DELIVERED
                              ? 'Delivered'
                              : order.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.DELIVERED ? (
                            <select
                              value={order.status}
                              onChange={(e) => {
                                const newStatus = e.target.value as OrderStatus;
                                if (
                                  newStatus === OrderStatus.DELIVERED &&
                                  order.paymentMethod === PaymentMethod.COD &&
                                  order.codCollectedAmount === undefined
                                ) {
                                  setCodCollectingOrder(order);
                                } else {
                                  updateOrderStatus(order.id, newStatus);
                                }
                              }}
                              className="bg-white border border-gray-300 text-gray-800 text-[11px] font-bold rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-[#0F2C59]"
                            >
                              <option value={OrderStatus.ORDER_PENDING}>Order Pending</option>
                              <option value={OrderStatus.ORDER_ACCEPTED}>Order Accepted</option>
                              <option value={OrderStatus.PACKING_IN_PROGRESS}>Packing</option>
                              <option value={OrderStatus.READY_FOR_DELIVERY}>Ready</option>
                              <option value={OrderStatus.ON_THE_WAY}>On The Way</option>
                              <option value={OrderStatus.DELIVERED}>Mark Delivered</option>
                            </select>
                          ) : (
                            <span className="text-[11px] text-gray-400 font-semibold">Completed</span>
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

        {/* TAB 2: INVENTORY & WHOLESALE SLABS */}
        {activeTab === 'INVENTORY' && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex flex-wrap justify-between items-center gap-3">
              {/* Standard Catalog Search */}
              <div className="flex-1 min-w-[220px] max-w-sm relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search catalog products..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className="w-full pl-8 pr-16 py-1.5 text-xs border border-gray-300 rounded-lg outline-none"
                />
                <button
                  type="button"
                  id="search-scan-barcode-btn"
                  onClick={() => setIsInventoryLookupScannerOpen(true)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#0F2C59] hover:text-[#FF6B00] transition-colors py-0.5 px-1.5 rounded hover:bg-orange-50 flex items-center gap-1 border border-gray-200"
                  title="Scan barcode to lookup product"
                >
                  <Scan size={12} className="text-[#FF6B00]" />
                  <span>Scan</span>
                </button>
              </div>

              {/* Barcode Quick Lookup Control Group */}
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 p-1 rounded-xl">
                <div className="relative">
                  <Barcode size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    id="inventory-manual-barcode-input"
                    placeholder="Enter barcode..."
                    value={manualBarcodeInput}
                    onChange={(e) => {
                      setManualBarcodeInput(e.target.value);
                      if (barcodeLookupError) setBarcodeLookupError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (manualBarcodeInput.trim()) {
                          handleBarcodeLookup(manualBarcodeInput);
                        }
                      }
                    }}
                    className="w-32 sm:w-40 pl-7 pr-2 py-1 text-xs font-mono border border-gray-300 rounded-lg outline-none focus:border-[#0F2C59] bg-white text-gray-900"
                  />
                </div>
                <button
                  type="button"
                  id="inventory-barcode-lookup-btn"
                  onClick={() => {
                    if (manualBarcodeInput.trim()) {
                      handleBarcodeLookup(manualBarcodeInput);
                    } else {
                      setIsInventoryLookupScannerOpen(true);
                    }
                  }}
                  className="px-2.5 py-1 bg-white hover:bg-gray-100 text-[#0F2C59] border border-gray-300 text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer"
                  title={manualBarcodeInput.trim() ? "Lookup entered barcode" : "Scan barcode with camera"}
                >
                  <span>Lookup</span>
                </button>
                <button
                  type="button"
                  id="inventory-barcode-scan-btn"
                  onClick={() => setIsInventoryLookupScannerOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#0F2C59] hover:bg-[#1a3f7a] text-white text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer"
                  title="Scan barcode with camera"
                >
                  <Scan size={12} className="text-[#FF6B00]" />
                  <span className="hidden sm:inline">Scan Barcode</span>
                  <span className="sm:hidden">Scan</span>
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  id="btn-inventory-manage-categories"
                  onClick={() => setActiveTab('CATEGORIES')}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border border-gray-200"
                  title="Manage product categories"
                >
                  <Tag size={13} className="text-[#FF6B00]" />
                  <span>Categories</span>
                </button>

                <button
                  id="open-add-product-btn"
                  onClick={handleOpenAddProductModal}
                  className="bg-[#0F2C59] hover:bg-[#153e7d] text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow transition"
                >
                  <Plus size={14} className="text-[#D4AF37]" />
                  <span>Add New Product & Tier Slabs</span>
                </button>
              </div>
            </div>

            {/* Inline validation feedback if manual input has errors */}
            {barcodeLookupError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3.5 py-2 rounded-xl flex items-center justify-between animate-in fade-in duration-150">
                <span className="flex items-center gap-1.5">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  {barcodeLookupError}
                </span>
                <button
                  type="button"
                  onClick={() => setBarcodeLookupError(null)}
                  className="text-red-400 hover:text-red-700 font-bold p-0.5"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            {/* Barcode-Based Product Lookup Banner (Found, Not Found, or Duplicate) */}
            <BarcodeLookupBanner
              result={barcodeLookupResult}
              onClear={handleClearBarcodeLookup}
              onOpenEditor={(p) => setEditingProduct(p)}
              onAddVariant={(p) => setAddingVariantProduct(p)}
              onAddProductWithBarcode={(barcode) => handleOpenAddProductModalWithBarcode(barcode)}
              onUpdateStock={(p) => setStockAdjustProduct(p)}
              onlyShowMatched={onlyShowLookupMatched}
              onToggleOnlyShowMatched={() => setOnlyShowLookupMatched((prev) => !prev)}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayedProducts.map((p) => (
                <div
                  key={p.id}
                  id={`inventory-product-${p.id}`}
                  className={`bg-white rounded-xl border p-4 shadow-sm flex flex-col justify-between transition-all duration-300 ${
                    highlightedProductId === p.id
                      ? 'border-[#FF6B00] ring-4 ring-[#FF6B00]/30 shadow-lg bg-orange-50/15'
                      : 'border-gray-200'
                  }`}
                >
                  <div>
                    {highlightedProductId === p.id && (
                      <div className="mb-2.5 flex items-center justify-between bg-[#FF6B00]/10 border border-[#FF6B00]/30 px-2.5 py-1 rounded-lg">
                        <span className="text-[10px] font-black uppercase text-[#FF6B00] flex items-center gap-1">
                          <CheckCircle2 size={12} />
                          <span>Exact Barcode Match</span>
                        </span>
                        <span className="text-[10px] font-mono font-bold text-gray-700">
                          {p.barcode}
                        </span>
                      </div>
                    )}
                    <div className="flex gap-3">
                      {p.imageUrl && p.imageUrl.trim() ? (
                        <button
                          type="button"
                          onClick={() => setZoomImageProduct(p)}
                          className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 shrink-0 relative group/thumb cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#0F2C59]"
                          title={`Click to preview full photo of ${p.name}`}
                          aria-label={`View larger photo of ${p.name}`}
                        >
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
                          />
                          <span className="absolute inset-0 bg-black/30 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center text-white transition-opacity">
                            <ZoomIn size={14} />
                          </span>
                        </button>
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-400">
                          <Package size={24} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          {p.brand ? (
                            <span className="text-[10px] font-bold text-[#FF6B00] uppercase truncate">{p.brand}</span>
                          ) : (
                            <span />
                          )}
                          {p.barcode && (
                            <span className="text-[9px] font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 shrink-0" title={`Barcode: ${p.barcode}`}>
                              {p.barcode}
                            </span>
                          )}
                        </div>
                        
                        {/* Item Name and Action Buttons */}
                        <div className="mt-0.5">
                          <h4 className="text-sm font-extrabold text-gray-900 line-clamp-1">{p.name}</h4>
                          
                          {/* Two action buttons in front of every individual item */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              id={`item-edit-btn-${p.id}`}
                              onClick={() => setEditingProduct(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-gray-100 text-[#0F2C59] border border-[#0F2C59]/30 hover:border-[#0F2C59] text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer touch-manipulation"
                              title={`Edit ${p.name}`}
                            >
                              <Edit3 size={13} className="text-[#0F2C59]" />
                              <span>Edit</span>
                            </button>

                            <button
                              type="button"
                              id={`item-add-variant-btn-${p.id}`}
                              onClick={() => setAddingVariantProduct(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#0F2C59] hover:bg-[#163a6e] text-white text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer touch-manipulation"
                              title={`+ Add Variant for ${p.name}`}
                            >
                              <Plus size={13} className="text-[#D4AF37]" />
                              <span>+ Add Variant</span>
                            </button>

                            {highlightedProductId === p.id && (
                              <button
                                type="button"
                                id={`item-adjust-stock-btn-${p.id}`}
                                onClick={() => setStockAdjustProduct(p)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-bold rounded-lg shadow-2xs transition active:scale-95 cursor-pointer touch-manipulation"
                                title={`Adjust Stock for ${p.name}`}
                              >
                                <Boxes size={13} />
                                <span>Adjust Stock</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-[10px] text-gray-500 mt-1.5 font-medium">
                          {p.variants.length} Pack Sizes / Variants
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {p.variants.map((v) => (
                        <div key={v.id} className="bg-gray-50 p-2 rounded-lg border border-gray-200 text-xs">
                          <div className="flex justify-between items-center font-bold">
                            <span>{formatVariantPack(v)}</span>
                            <span className="text-[#0F2C59]">₹{v.baseSellingPrice} (MRP ₹{v.mrp})</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-gray-500 mt-1">
                            <span>Stock: {v.stockQuantity} units</span>
                            <span>Max Order: {v.maxOrderLimit}</span>
                          </div>
                          {v.tieredPrices && v.tieredPrices.length > 0 && (
                            <div className="mt-1 pt-1 border-t border-gray-200 text-[9px] text-emerald-800 font-semibold">
                              Bulk Slab: {v.tieredPrices[0].minQty}+ units @ ₹{v.tieredPrices[0].unitPrice}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${p.isDiscountExcluded ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {p.isDiscountExcluded ? 'Price Regulated' : 'Full Discount Eligible'}
                    </span>
                    <button
                      onClick={() => deleteProduct(p.id)}
                      className="text-gray-400 hover:text-red-600 transition"
                      title="Delete Product"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB: CATEGORY MANAGEMENT */}
        {activeTab === 'CATEGORIES' && (
          <CategoryManagement />
        )}

        {/* TAB 3: ENGINE SETTINGS */}
        {activeTab === 'SETTINGS' && (
          <AdminSettingsControl />
        )}

        {/* TAB 4: REGISTERED CUSTOMERS */}
        {activeTab === 'CUSTOMERS' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="text-base font-extrabold text-[#0F2C59] flex items-center gap-2">
                  <Users size={18} className="text-[#FF6B00]" />
                  <span>Verified Customer Directory ({customerUsers.length})</span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Universal accounts synchronized across all browsers &amp; devices via mobile number
                </p>
              </div>

              <div className="relative min-w-[240px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search customer by name or phone..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-xl text-xs outline-none focus:border-[#0F2C59]"
                />
              </div>
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-xs">
                No customer accounts match your search.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#0F2C59] text-white uppercase text-[10px] tracking-wider">
                      <th className="p-3">Customer</th>
                      <th className="p-3">Primary Delivery Address</th>
                      <th className="p-3 text-center">COD Orders</th>
                      <th className="p-3 text-center">Store Wallet</th>
                      <th className="p-3">Referral Code</th>
                      <th className="p-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredCustomers.map((c) => (
                      <tr key={c.id} className="hover:bg-blue-50/30 transition">
                        <td className="p-3">
                          <div className="font-bold text-gray-900">{c.name}</div>
                          <div className="font-mono text-gray-600 text-[11px] flex items-center gap-1 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span>+91 {c.phone}</span>
                          </div>
                        </td>
                        <td className="p-3 text-gray-600 max-w-xs">
                          {c.addresses && c.addresses.length > 0 ? (
                            <div>
                              <div className="font-medium text-gray-800 line-clamp-1">{c.addresses[0].fullAddress}</div>
                              {c.addresses[0].landmark && (
                                <div className="text-[10px] text-gray-500">Near {c.addresses[0].landmark}, {c.addresses[0].pincode}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">No address on file</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-bold text-gray-800">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${c.codOrderCount >= 3 ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}>
                            {c.codOrderCount || 0} / 3 free
                          </span>
                        </td>
                        <td className="p-3 text-center font-bold text-emerald-700 font-mono">
                          ₹{c.walletBalance || 0}
                        </td>
                        <td className="p-3 font-mono font-bold text-indigo-700 text-[11px]">
                          {c.referralCode || 'N/A'}
                        </td>
                        <td className="p-3 text-gray-500 text-[11px]">
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN') : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Product Modal */}
      {isAddProductModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden border border-gray-300 my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-[#0F2C59] text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
                  <Package size={20} />
                </div>
                <div>
                  <h3 className="font-black text-base sm:text-lg text-white leading-tight">
                    Add New Wholesale / Retail Product
                  </h3>
                  <p className="text-[11px] text-gray-300 mt-0.5">
                    Configure master details and add single or multiple pack size variants with wholesale volume slabs.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseAddProductModal}
                className="text-gray-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Scrollable Form Body */}
            <form onSubmit={handleCreateProduct} className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Validation Error Banner */}
              {formValidationError && (
                <div className="p-3.5 bg-red-50 border-2 border-red-300 text-red-900 rounded-xl flex items-center gap-2.5 font-bold shadow-sm">
                  <AlertCircle size={18} className="text-red-600 shrink-0" />
                  <span>{formValidationError}</span>
                </div>
              )}

              {/* Section 1: Basic Product Information */}
              <div className="bg-gray-50/80 p-4 rounded-xl border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[#0F2C59] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Info size={14} className="text-[#FF6B00]" />
                    1. Basic Product Details
                  </span>
                  <span className="text-[10px] text-gray-500 font-medium">* Required fields</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">
                      Product Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      id="new-product-name-input"
                      placeholder="e.g. Kolam Steam Rice / Tata Salt"
                      value={newProductData.name}
                      onChange={(e) => setNewProductData({ ...newProductData, name: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] font-bold text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">
                      Brand Name <span className="text-xs text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      id="new-product-brand-input"
                      placeholder="e.g. Om Premium / Tata / Fortune (Optional)"
                      value={newProductData.brand}
                      onChange={(e) => setNewProductData({ ...newProductData, brand: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Category</label>
                    <select
                      id="new-product-category-select"
                      value={newProductData.categoryId}
                      onChange={(e) => setNewProductData({ ...newProductData, categoryId: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-xl outline-none focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59] font-medium text-gray-900 bg-white"
                    >
                      <option value="">-- Select Category --</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-gray-700">
                        Barcode <span className="text-xs text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <button
                        type="button"
                        id="add-scan-barcode-btn"
                        onClick={() => setIsAddBarcodeScannerOpen(true)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F2C59] hover:text-[#FF6B00] transition-colors py-0.5 px-2 rounded-lg hover:bg-orange-50 border border-gray-200 hover:border-[#FF6B00]/40"
                        title="Scan barcode with camera"
                      >
                        <Scan className="w-3.5 h-3.5 text-[#FF6B00]" />
                        <span>Scan</span>
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        id="new-product-barcode-input"
                        placeholder="e.g. 8901030383321"
                        value={newProductData.barcode}
                        onChange={(e) => {
                          setNewProductData({ ...newProductData, barcode: e.target.value });
                          if (formValidationError?.toLowerCase().includes('barcode')) {
                            setFormValidationError(null);
                          }
                        }}
                        className={`w-full p-2.5 border rounded-xl outline-none font-mono text-gray-900 bg-white pr-9 ${
                          newBarcodeConflict
                            ? 'border-amber-400 bg-amber-50/50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                            : 'border-gray-300 focus:border-[#0F2C59] focus:ring-1 focus:ring-[#0F2C59]'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setIsAddBarcodeScannerOpen(true)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#FF6B00] transition-colors p-1"
                        title="Scan barcode with camera"
                      >
                        <Scan className="w-4 h-4" />
                      </button>
                    </div>
                    {newBarcodeConflict && (
                      <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                        Already used by &quot;{newBarcodeConflict.name}&quot;{newBarcodeConflict.brand ? ` (${newBarcodeConflict.brand})` : ''}
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-1 space-y-3">
                  <ProductImageUploader
                    currentImageUrl={newProductData.imageUrl}
                    onImageChange={(newUrl) => setNewProductData({ ...newProductData, imageUrl: newUrl })}
                    productName={newProductData.name}
                  />

                  <div className="flex items-center pt-1">
                    <label className="flex items-center gap-2 cursor-pointer font-bold text-gray-700 select-none">
                      <input
                        type="checkbox"
                        checked={newProductData.isDiscountExcluded}
                        onChange={(e) =>
                          setNewProductData({ ...newProductData, isDiscountExcluded: e.target.checked })
                        }
                        className="w-4 h-4 rounded text-[#0F2C59]"
                      />
                      <span>Price Regulated / Discount Excluded</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Section 2: Multiple Pack Variants & Wholesale Slabs Table */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2.5">
                  <div>
                    <h4 className="font-extrabold text-[#0F2C59] text-sm flex items-center gap-1.5">
                      <Layers size={16} className="text-[#FF6B00]" />
                      2. Pack Variants & Wholesale Pricing Table
                      <span className="bg-[#0F2C59] text-white px-2 py-0.5 rounded-full text-[10px] ml-1">
                        {variantRows.length} {variantRows.length === 1 ? 'Variant' : 'Variants'}
                      </span>
                    </h4>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      All fields open completely blank. Add multiple sizes (e.g. 500 G, 1 KG, 25 KG) for this single product.
                    </p>
                  </div>

                  {/* Primary Option: Add Blank Variant */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      id="add-blank-variant-row-btn"
                      onClick={handleAddBlankVariantRow}
                      className="bg-[#FF6B00] hover:bg-[#e05e00] text-white px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition"
                    >
                      <Plus size={15} />
                      <span>+ Add Pack Variant</span>
                    </button>
                  </div>
                </div>

                {/* Multiple Options: Quick Preset Chips Toolbar */}
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-black text-amber-900 flex items-center gap-1 mr-1">
                    <Sparkles size={13} className="text-[#FF6B00]" />
                    Quick Add Common Pack Sizes:
                  </span>
                  {COMMON_PACK_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleAddPresetVariantRow(preset.size, preset.unit)}
                      className="bg-white hover:bg-amber-100/80 text-amber-950 border border-amber-300/80 hover:border-amber-400 px-2 py-1 rounded-lg text-[11px] font-bold shadow-xs transition active:scale-95 flex items-center gap-1"
                      title={`Add ${preset.label} variant row`}
                    >
                      <Plus size={11} className="text-amber-700" />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>

                {/* The Variants Table */}
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[920px]">
                      <thead>
                        <tr className="bg-[#0F2C59] text-white text-[10.5px] uppercase tracking-wider">
                          <th className="p-2.5 text-center w-8">#</th>
                          <th className="p-2.5 w-24">Pack Size *</th>
                          <th className="p-2.5 w-28">Unit *</th>
                          <th className="p-2.5 w-24">MRP (₹) *</th>
                          <th className="p-2.5 w-28">Selling Price (₹) *</th>
                          <th className="p-2.5 w-20">Stock Qty</th>
                          <th className="p-2.5 w-24 bg-[#0b2245]">Wholesale Min Qty</th>
                          <th className="p-2.5 w-24 bg-[#0b2245]">Wholesale Max Qty</th>
                          <th className="p-2.5 w-28 bg-[#0b2245]">Wholesale Price (₹)</th>
                          <th className="p-2.5 w-32">Pack Label (Optional)</th>
                          <th className="p-2.5 text-center w-20">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {variantRows.map((row, idx) => (
                          <tr key={row.id} className="hover:bg-blue-50/30 transition">
                            {/* Row Index */}
                            <td className="p-2.5 text-center font-bold text-gray-500 font-mono text-[11px]">
                              {idx + 1}
                            </td>

                            {/* Pack Size Input */}
                            <td className="p-2">
                              <input
                                type="number"
                                step="any"
                                min="0.01"
                                placeholder="e.g. 1"
                                value={row.packSize}
                                onChange={(e) => handleUpdateVariantRow(idx, 'packSize', e.target.value)}
                                className="w-full p-1.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-900 outline-none focus:border-[#0F2C59]"
                              />
                            </td>

                            {/* Unit Select */}
                            <td className="p-2">
                              <select
                                value={row.unit}
                                onChange={(e) =>
                                  handleUpdateVariantRow(idx, 'unit', e.target.value as UnitType | '')
                                }
                                className="w-full p-1.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-900 outline-none bg-white focus:border-[#0F2C59]"
                              >
                                <option value="">Select Unit</option>
                                {Object.values(UnitType).map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* MRP Input */}
                            <td className="p-2">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="MRP ₹"
                                value={row.mrp}
                                onChange={(e) => handleUpdateVariantRow(idx, 'mrp', e.target.value)}
                                className="w-full p-1.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-900 outline-none focus:border-[#0F2C59]"
                              />
                            </td>

                            {/* Selling Price Input */}
                            <td className="p-2">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="Retail ₹"
                                value={row.baseSellingPrice}
                                onChange={(e) =>
                                  handleUpdateVariantRow(idx, 'baseSellingPrice', e.target.value)
                                }
                                className="w-full p-1.5 border border-emerald-400 bg-emerald-50/40 rounded-lg text-xs font-bold text-emerald-950 outline-none focus:border-emerald-600"
                              />
                            </td>

                            {/* Stock Qty */}
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                placeholder="Stock"
                                value={row.stockQuantity}
                                onChange={(e) =>
                                  handleUpdateVariantRow(idx, 'stockQuantity', e.target.value)
                                }
                                className="w-full p-1.5 border border-gray-300 rounded-lg text-xs text-gray-900 outline-none focus:border-[#0F2C59]"
                              />
                            </td>

                            {/* Wholesale Min Qty */}
                            <td className="p-2 bg-amber-50/30">
                              <input
                                type="number"
                                min="2"
                                placeholder="Min Qty"
                                value={row.wholesaleMinQty}
                                onChange={(e) =>
                                  handleUpdateVariantRow(idx, 'wholesaleMinQty', e.target.value)
                                }
                                className="w-full p-1.5 border border-amber-300 rounded-lg text-xs text-amber-950 outline-none focus:border-amber-500 bg-white"
                              />
                            </td>

                            {/* Wholesale Max Qty */}
                            <td className="p-2 bg-amber-50/30">
                              <input
                                type="number"
                                min="2"
                                placeholder="Max Qty"
                                value={row.wholesaleMaxQty}
                                onChange={(e) =>
                                  handleUpdateVariantRow(idx, 'wholesaleMaxQty', e.target.value)
                                }
                                className="w-full p-1.5 border border-amber-300 rounded-lg text-xs text-amber-950 outline-none focus:border-amber-500 bg-white"
                              />
                            </td>

                            {/* Wholesale Price */}
                            <td className="p-2 bg-amber-50/30">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="Wholesale ₹"
                                value={row.wholesalePrice}
                                onChange={(e) =>
                                  handleUpdateVariantRow(idx, 'wholesalePrice', e.target.value)
                                }
                                className="w-full p-1.5 border border-amber-400 rounded-lg text-xs font-bold text-amber-950 outline-none focus:border-amber-600 bg-amber-50/70"
                              />
                            </td>

                            {/* Pack Label */}
                            <td className="p-2">
                              <input
                                type="text"
                                placeholder="e.g. 1 KG Pouch"
                                value={row.packLabel}
                                onChange={(e) => handleUpdateVariantRow(idx, 'packLabel', e.target.value)}
                                className="w-full p-1.5 border border-gray-300 rounded-lg text-xs text-gray-800 outline-none focus:border-[#0F2C59]"
                              />
                            </td>

                            {/* Actions: Duplicate & Delete */}
                            <td className="p-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  title="Duplicate this pack variant row"
                                  onClick={() => handleDuplicateVariantRow(idx)}
                                  className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  type="button"
                                  title="Delete this variant row"
                                  disabled={variantRows.length <= 1}
                                  onClick={() => handleRemoveVariantRow(idx)}
                                  className={`p-1.5 rounded-lg transition ${
                                    variantRows.length <= 1
                                      ? 'text-gray-300 cursor-not-allowed'
                                      : 'text-red-500 hover:bg-red-100'
                                  }`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-500 px-1">
                  <span>
                    💡 <strong>Multiple Options:</strong> Click <em>'+ Add Pack Variant'</em> to add another blank row, click any <em>Quick Preset</em> chip above (e.g. + 500 G, + 1 KG), or click the <Copy size={11} className="inline mx-0.5 text-blue-600" /> icon to duplicate any row.
                  </span>
                  <button
                    type="button"
                    onClick={handleAddBlankVariantRow}
                    className="font-bold text-[#0F2C59] hover:underline flex items-center gap-1 mt-1 sm:mt-0"
                  >
                    <Plus size={13} />
                    <span>+ Add Another Variant Row</span>
                  </button>
                </div>
              </div>

              {/* Modal Footer Controls */}
              <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-gray-200 shrink-0">
                <div className="text-[11px] text-gray-500 font-medium">
                  {variantRows.length} pack variant(s) ready to create.
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={handleCloseAddProductModal}
                    className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-xl font-bold text-xs transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    id="submit-create-product-btn"
                    disabled={isSubmittingProduct}
                    className="px-5 py-2 bg-[#0F2C59] hover:bg-[#153e7d] text-white font-extrabold rounded-xl text-xs shadow-md transition flex items-center gap-2 disabled:opacity-50"
                  >
                    <Check size={16} className="text-[#D4AF37]" />
                    <span>{isSubmittingProduct ? 'Saving to Database...' : `Save & Create Product (${variantRows.length} Variants)`}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <LogoUploadModal
        isOpen={isLogoModalOpen}
        onClose={() => setIsLogoModalOpen(false)}
      />

      {/* Edit Individual Item Modal */}
      <EditProductModal
        product={editingProduct}
        isOpen={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        onSave={handleSaveEditProduct}
        existingProducts={products}
      />

      {/* Add Variant to Specific Item Modal */}
      <AddVariantModal
        product={addingVariantProduct}
        isOpen={Boolean(addingVariantProduct)}
        onClose={() => setAddingVariantProduct(null)}
        onAddVariant={handleAddVariantToProduct}
      />

      {/* Barcode Scanner for Add Product */}
      <BarcodeScannerModal
        isOpen={isAddBarcodeScannerOpen}
        onClose={() => setIsAddBarcodeScannerOpen(false)}
        onScan={(scannedBarcode) => {
          setNewProductData((prev) => ({ ...prev, barcode: scannedBarcode }));
          if (formValidationError?.toLowerCase().includes('barcode')) {
            setFormValidationError(null);
          }
        }}
        title="Scan Barcode for New Product"
        subtitle="Align product package barcode within camera frame"
        currentBarcode={newProductData.barcode}
        existingProducts={products}
      />

      {/* Barcode-Assisted Stock Adjustment Modal */}
      <StockAdjustmentModal
        product={stockAdjustProduct}
        isOpen={Boolean(stockAdjustProduct)}
        onClose={() => setStockAdjustProduct(null)}
        onSaveStock={handleSaveStock}
        onOpenEditor={(p) => {
          setStockAdjustProduct(null);
          setEditingProduct(p);
        }}
      />

      {/* Barcode Scanner for Inventory Lookup & Product Identification */}
      <BarcodeScannerModal
        isOpen={isInventoryLookupScannerOpen || isInventorySearchScannerOpen}
        onClose={() => {
          setIsInventoryLookupScannerOpen(false);
          setIsInventorySearchScannerOpen(false);
        }}
        onScan={(scannedBarcode) => {
          handleBarcodeLookup(scannedBarcode);
        }}
        title="Lookup Product by Barcode"
        subtitle="Scan or enter any product barcode to instantly locate and inspect"
        allowDuplicates={true}
        existingProducts={products}
      />

      {/* COD Cash Collection & Deposit Modal */}
      <CodCollectionModal
        order={codCollectingOrder}
        isOpen={Boolean(codCollectingOrder)}
        onClose={() => setCodCollectingOrder(null)}
        onSave={(orderId, amount, markDelivered) => {
          return recordCodCollection(orderId, amount, markDelivered);
        }}
      />

      {/* Product Image Lightbox Preview */}
      <ImageLightboxModal
        isOpen={Boolean(zoomImageProduct && zoomImageProduct.imageUrl)}
        onClose={() => setZoomImageProduct(null)}
        imageUrl={zoomImageProduct?.imageUrl}
        title={zoomImageProduct?.name}
        subtitle={zoomImageProduct?.brand}
      />
    </div>
  );
};
