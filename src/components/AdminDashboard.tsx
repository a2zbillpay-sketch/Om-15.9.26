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
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { OrderStatus, PaymentMethod, Product, ProductVariant, TieredPrice, UnitType, Role } from '../types';
import { AdminSettingsControl } from './AdminSettingsControl';
import { LogoUploadModal } from './LogoUploadModal';
import { EditProductModal } from './EditProductModal';
import { AddVariantModal } from './AddVariantModal';
import { formatVariantPack } from '../utils/variantFormatter';

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
  } = useApp();

  const [activeTab, setActiveTab] = useState<'ORDERS' | 'INVENTORY' | 'SETTINGS'>('ORDERS');
  const [orderFilter, setOrderFilter] = useState<string>('ALL');
  const [inventorySearch, setInventorySearch] = useState<string>('');
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);

  // Add product modal state
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  // Edit individual product state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  // Add variant to individual product state
  const [addingVariantProduct, setAddingVariantProduct] = useState<Product | null>(null);

  const handleSaveEditProduct = (productId: string, updates: Partial<Product>) => {
    updateProduct(productId, updates);
  };

  const handleAddVariantToProduct = (productId: string, newVariant: ProductVariant) => {
    const target = products.find((p) => p.id === productId);
    if (!target) return;
    updateProduct(productId, {
      variants: [...target.variants, newVariant],
    });
  };

  // Main product form state - starts completely BLANK without hardcoded defaults
  const [newProductData, setNewProductData] = useState({
    name: '',
    brand: '',
    description: '',
    categoryId: '',
    imageUrl: '',
    isDiscountExcluded: false,
  });

  // Multiple variants state for the new product - always starts with a 100% BLANK row
  const [variantRows, setVariantRows] = useState<VariantFormRow[]>([createBlankVariantRow()]);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);

  const handleOpenAddProductModal = () => {
    setNewProductData({
      name: '',
      brand: '',
      description: '',
      categoryId: categories[0]?.id || '',
      imageUrl: '',
      isDiscountExcluded: false,
    });
    // Table always opens completely blank with 0 pre-filled values
    setVariantRows([createBlankVariantRow()]);
    setFormValidationError(null);
    setIsAddProductModalOpen(true);
  };

  const handleCloseAddProductModal = () => {
    setNewProductData({
      name: '',
      brand: '',
      description: '',
      categoryId: '',
      imageUrl: '',
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
    (o) => o.status === OrderStatus.ORDER_ACCEPTED || o.status === OrderStatus.PACKING_IN_PROGRESS
  ).length;

  const deliveredCount = orders.filter((o) => o.status === OrderStatus.DELIVERED).length;

  const filteredOrders = orders.filter((o) => {
    if (orderFilter === 'ALL') return true;
    return o.status === orderFilter;
  });

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(inventorySearch.toLowerCase()) ||
      p.brand.toLowerCase().includes(inventorySearch.toLowerCase())
  );

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    setFormValidationError(null);

    const trimmedName = newProductData.name.trim();
    if (!trimmedName) {
      setFormValidationError('Please enter a Product Name.');
      return;
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
        setFormValidationError(`Variant #${rowNum}: Please enter a valid positive Pack Size (e.g. 1, 500, 25).`);
        return;
      }

      if (!row.unit) {
        setFormValidationError(`Variant #${rowNum}: Please select a Unit (e.g. KG, G, LITER, BOX, KATTA).`);
        return;
      }

      if (!row.mrp || isNaN(Number(row.mrp)) || Number(row.mrp) <= 0) {
        setFormValidationError(`Variant #${rowNum}: Please enter MRP in ₹.`);
        return;
      }

      if (!row.baseSellingPrice || isNaN(Number(row.baseSellingPrice)) || Number(row.baseSellingPrice) <= 0) {
        setFormValidationError(`Variant #${rowNum}: Please enter Base Selling Price in ₹.`);
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
      brand: newProductData.brand.trim() || 'Om Premium',
      description: newProductData.description.trim(),
      categoryId: newProductData.categoryId || categories[0]?.id || 'cat-1',
      imageUrl:
        newProductData.imageUrl.trim() ||
        'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=500&q=80',
      isDiscountExcluded: newProductData.isDiscountExcluded,
      variants: constructedVariants,
    };

    addProduct(product);
    handleCloseAddProductModal();
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

            <div className="flex bg-[#0a1e3d] p-1 rounded-xl border border-white/10 text-xs font-bold">
              <button
                onClick={() => setActiveTab('ORDERS')}
                className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'ORDERS' ? 'bg-[#FF6B00] text-white shadow' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Package size={14} />
                <span>Orders ({orders.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('INVENTORY')}
                className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'INVENTORY' ? 'bg-[#FF6B00] text-white shadow' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Layers size={14} />
                <span>Inventory & Catalog</span>
              </button>
              <button
                onClick={() => setActiveTab('SETTINGS')}
                className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                  activeTab === 'SETTINGS' ? 'bg-[#D4AF37] text-[#0F2C59] shadow font-black' : 'text-gray-300 hover:text-white'
                }`}
              >
                <Settings size={14} />
                <span>Engine Settings</span>
              </button>
            </div>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-[11px] font-bold text-gray-500 uppercase">Gross Order Sales</div>
            <div className="text-2xl font-black text-[#0F2C59] mt-1">₹{totalRevenue.toLocaleString('en-IN')}</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
              <TrendingUp size={12} />
              <span>Combined Advance & COD</span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-[11px] font-bold text-gray-500 uppercase">Pending In Packing</div>
            <div className="text-2xl font-black text-[#FF6B00] mt-1">{pendingOrdersCount}</div>
            <div className="text-[10px] text-gray-500 mt-1">Awaiting fulfillment queue</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-[11px] font-bold text-gray-500 uppercase">Delivered Orders</div>
            <div className="text-2xl font-black text-emerald-700 mt-1">{deliveredCount}</div>
            <div className="text-[10px] text-gray-500 mt-1">Completed fulfillments</div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-[11px] font-bold text-gray-500 uppercase">Catalog Products</div>
            <div className="text-2xl font-black text-purple-700 mt-1">{products.length}</div>
            <div className="text-[10px] text-gray-500 mt-1">Across 15 grocery categories</div>
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
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              order.paymentMethod === PaymentMethod.ADVANCE_ONLINE
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {order.paymentMethod === PaymentMethod.ADVANCE_ONLINE ? 'UPI Advance' : 'COD'}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="font-medium text-gray-800">
                            {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                          </span>
                          <div className="text-[10px] text-gray-500 truncate max-w-[150px]">
                            {order.items.map((i) => i.productName).join(', ')}
                          </div>
                        </td>
                        <td className="p-3 font-black text-gray-900">
                          ₹{order.finalAmount}
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
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {order.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.DELIVERED ? (
                            <select
                              value={order.status}
                              onChange={(e) => updateOrderStatus(order.id, e.target.value as OrderStatus)}
                              className="bg-white border border-gray-300 text-gray-800 text-[11px] font-bold rounded-lg p-1.5 outline-none focus:ring-1 focus:ring-[#0F2C59]"
                            >
                              <option value={OrderStatus.ORDER_ACCEPTED}>Order Accepted</option>
                              <option value={OrderStatus.PACKING_IN_PROGRESS}>Packing In Progress</option>
                              <option value={OrderStatus.READY_FOR_DELIVERY}>Ready for Delivery</option>
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
              <div className="flex-1 max-w-sm relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search catalog products..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg outline-none"
                />
              </div>

              <button
                id="open-add-product-btn"
                onClick={handleOpenAddProductModal}
                className="bg-[#0F2C59] hover:bg-[#153e7d] text-white px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow transition"
              >
                <Plus size={14} className="text-[#D4AF37]" />
                <span>Add New Product & Tier Slabs</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex gap-3">
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-16 h-16 rounded-lg object-cover border shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-bold text-[#FF6B00] uppercase truncate">{p.brand}</div>
                        
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

        {/* TAB 3: ENGINE SETTINGS */}
        {activeTab === 'SETTINGS' && (
          <AdminSettingsControl />
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    <label className="font-bold text-gray-700 block mb-1">Brand Name</label>
                    <input
                      type="text"
                      id="new-product-brand-input"
                      placeholder="e.g. Om Premium / Tata / Fortune"
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="sm:col-span-2">
                    <label className="font-bold text-gray-700 block mb-1">Image URL (Optional)</label>
                    <input
                      type="text"
                      id="new-product-image-input"
                      placeholder="https://... (or leave blank for automatic category default)"
                      value={newProductData.imageUrl}
                      onChange={(e) => setNewProductData({ ...newProductData, imageUrl: e.target.value })}
                      className="w-full p-2.5 border border-gray-300 rounded-xl outline-none text-gray-800 bg-white"
                    />
                  </div>

                  <div className="flex items-center pt-5">
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
                    className="px-5 py-2 bg-[#0F2C59] hover:bg-[#153e7d] text-white font-extrabold rounded-xl text-xs shadow-md transition flex items-center gap-2"
                  >
                    <Check size={16} className="text-[#D4AF37]" />
                    <span>Save & Create Product ({variantRows.length} Variants)</span>
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
      />

      {/* Add Variant to Specific Item Modal */}
      <AddVariantModal
        product={addingVariantProduct}
        isOpen={Boolean(addingVariantProduct)}
        onClose={() => setAddingVariantProduct(null)}
        onAddVariant={handleAddVariantToProduct}
      />
    </div>
  );
};
