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
  Trash2,
  Search,
  Filter,
  DollarSign,
  AlertCircle,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { OrderStatus, PaymentMethod, Product, UnitType } from '../types';
import { AdminSettingsControl } from './AdminSettingsControl';
import { LogoUploadModal } from './LogoUploadModal';

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
  } = useApp();

  const [activeTab, setActiveTab] = useState<'ORDERS' | 'INVENTORY' | 'SETTINGS'>('ORDERS');
  const [orderFilter, setOrderFilter] = useState<string>('ALL');
  const [inventorySearch, setInventorySearch] = useState<string>('');
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);

  // Add product modal state
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [newProductData, setNewProductData] = useState({
    name: '',
    brand: '',
    description: '',
    categoryId: categories[0]?.id || 'cat-1',
    imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=500&q=80',
    isDiscountExcluded: false,
    variantUnit: UnitType.KG,
    variantPackSize: 1,
    variantPackLabel: '1 KG Pack',
    variantMrp: 100,
    variantBasePrice: 85,
    variantStock: 100,
    variantMaxLimit: 20,
    tierMin: 5,
    tierMax: 20,
    tierPrice: 78,
  });

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
    const variantId = `var-${Date.now()}`;
    const product = {
      name: newProductData.name,
      brand: newProductData.brand || 'Om Special',
      description: newProductData.description,
      categoryId: newProductData.categoryId,
      imageUrl: newProductData.imageUrl,
      isDiscountExcluded: newProductData.isDiscountExcluded,
      variants: [
        {
          id: variantId,
          productId: '',
          unit: newProductData.variantUnit,
          packSize: Number(newProductData.variantPackSize),
          packLabel: newProductData.variantPackLabel,
          mrp: Number(newProductData.variantMrp),
          baseSellingPrice: Number(newProductData.variantBasePrice),
          stockQuantity: Number(newProductData.variantStock),
          maxOrderLimit: Number(newProductData.variantMaxLimit),
          tieredPrices: [
            {
              id: `tp-${Date.now()}`,
              variantId,
              minQty: Number(newProductData.tierMin),
              maxQty: Number(newProductData.tierMax),
              unitPrice: Number(newProductData.tierPrice),
            },
          ],
        },
      ],
    };

    addProduct(product);
    setIsAddProductModalOpen(false);
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
                onClick={() => setIsAddProductModalOpen(true)}
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
                        <h4 className="text-xs font-bold text-gray-900 line-clamp-1">{p.name}</h4>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {p.variants.length} Pack Sizes / Variants
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {p.variants.map((v) => (
                        <div key={v.id} className="bg-gray-50 p-2 rounded-lg border border-gray-200 text-xs">
                          <div className="flex justify-between items-center font-bold">
                            <span>{v.packLabel}</span>
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto border-t-4 border-[#0F2C59]">
            <h3 className="font-extrabold text-base text-[#0F2C59] mb-4">Add New Wholesale / Retail Item</h3>
            <form onSubmit={handleCreateProduct} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-gray-700 block mb-1">Product Name</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Kolam Steam Rice"
                  value={newProductData.name}
                  onChange={(e) => setNewProductData({ ...newProductData, name: e.target.value })}
                  className="w-full p-2 border rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Brand</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Om Premium"
                    value={newProductData.brand}
                    onChange={(e) => setNewProductData({ ...newProductData, brand: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Category</label>
                  <select
                    value={newProductData.categoryId}
                    onChange={(e) => setNewProductData({ ...newProductData, categoryId: e.target.value })}
                    className="w-full p-2 border rounded-lg"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Pack Size</label>
                  <input
                    type="number"
                    value={newProductData.variantPackSize}
                    onChange={(e) => setNewProductData({ ...newProductData, variantPackSize: Number(e.target.value) })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Unit</label>
                  <select
                    value={newProductData.variantUnit}
                    onChange={(e) => setNewProductData({ ...newProductData, variantUnit: e.target.value as UnitType })}
                    className="w-full p-2 border rounded-lg"
                  >
                    {Object.values(UnitType).map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Stock Qty</label>
                  <input
                    type="number"
                    value={newProductData.variantStock}
                    onChange={(e) => setNewProductData({ ...newProductData, variantStock: Number(e.target.value) })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-gray-700 block mb-1">MRP (₹)</label>
                  <input
                    type="number"
                    value={newProductData.variantMrp}
                    onChange={(e) => setNewProductData({ ...newProductData, variantMrp: Number(e.target.value) })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Base Selling Price (₹)</label>
                  <input
                    type="number"
                    value={newProductData.variantBasePrice}
                    onChange={(e) => setNewProductData({ ...newProductData, variantBasePrice: Number(e.target.value) })}
                    className="w-full p-2 border rounded-lg"
                  />
                </div>
              </div>

              {/* Wholesale Slab Setting */}
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                <div className="font-bold text-amber-900 mb-1">Wholesale Volume Slab:</div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="text-[10px] text-gray-600 block">Min Qty</span>
                    <input
                      type="number"
                      value={newProductData.tierMin}
                      onChange={(e) => setNewProductData({ ...newProductData, tierMin: Number(e.target.value) })}
                      className="w-full p-1.5 border rounded"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-600 block">Max Qty</span>
                    <input
                      type="number"
                      value={newProductData.tierMax}
                      onChange={(e) => setNewProductData({ ...newProductData, tierMax: Number(e.target.value) })}
                      className="w-full p-1.5 border rounded"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-600 block">Slab Price (₹)</span>
                    <input
                      type="number"
                      value={newProductData.tierPrice}
                      onChange={(e) => setNewProductData({ ...newProductData, tierPrice: Number(e.target.value) })}
                      className="w-full p-1.5 border rounded"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddProductModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#0F2C59] text-white font-bold rounded-lg"
                >
                  Create Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <LogoUploadModal
        isOpen={isLogoModalOpen}
        onClose={() => setIsLogoModalOpen(false)}
      />
    </div>
  );
};
