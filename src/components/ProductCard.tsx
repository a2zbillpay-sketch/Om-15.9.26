import React, { useState } from 'react';
import { Plus, Minus, Layers, AlertCircle, Package, ZoomIn, BellRing, CheckCircle2 } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { useApp } from '../context/AppContext';
import { getActiveUnitPrice } from '../lib/engine/checkout-calculator';
import { formatVariantPack } from '../utils/variantFormatter';
import { ImageLightboxModal } from './ImageLightboxModal';
import { ProductRequestModal } from './ProductRequestModal';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { cart, addToCart, updateCartQty, settings, requestProduct, currentUser } = useApp();
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    product.variants[0]?.id || ''
  );
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestedQty, setRequestedQty] = useState<number>(1);
  const [hasRequested, setHasRequested] = useState<boolean>(false);
  const [lastRequestDate, setLastRequestDate] = useState<string>('');

  const isExcluded =
    product.isDiscountExcluded === true || (product.isDiscountExcluded as any) === 'true';

  const currentVariant =
    product.variants.find((v) => v.id === selectedVariantId) || product.variants[0];

  // Find if variant is currently in cart
  const cartItem = cart.find((item) => item.variantId === currentVariant?.id);
  const cartQuantity = cartItem ? cartItem.quantity : 0;

  if (!currentVariant) return null;

  const currentPrice = getActiveUnitPrice(
    currentVariant.baseSellingPrice,
    cartQuantity > 0 ? cartQuantity : 1,
    currentVariant.tieredPrices || []
  );

  const discountPercent = Math.round(
    ((currentVariant.mrp - currentPrice) / currentVariant.mrp) * 100
  );

  const handleAdd = () => {
    addToCart(product, currentVariant, 1);
  };

  const handleIncrement = () => {
    if (cartQuantity < Math.min(currentVariant.stockQuantity, currentVariant.maxOrderLimit)) {
      updateCartQty(currentVariant.id, cartQuantity + 1);
    }
  };

  const handleDecrement = () => {
    updateCartQty(currentVariant.id, cartQuantity - 1);
  };

  const handleRequestProduct = () => {
    const qty = Math.max(1, requestedQty);
    const req = requestProduct({
      product,
      variant: currentVariant,
      quantity: qty,
    });
    setHasRequested(true);
    setLastRequestDate(req.requestDate);
    setIsRequestModalOpen(true);
  };

  const isOutOfStock =
    Number(currentVariant?.stockQuantity ?? 0) <= 0 ||
    ((product as any).stock !== undefined &&
      Number((product as any).stock) <= 0 &&
      (!product.variants || product.variants.length === 0 || product.variants.every((v) => Number(v.stockQuantity || 0) <= 0))) ||
    (!product.variants || product.variants.length === 0 || product.variants.every((v) => Number(v.stockQuantity || 0) <= 0));

  return (
    <div
      id={`product-card-${product.id}`}
      className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
    >
      <div>
        {/* Top Badges Bar */}
        <div className="pt-2.5 px-3 flex items-center justify-between gap-1 min-h-[28px]">
          {isOutOfStock ? (
            <span className="bg-red-600 text-white font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-xs">
              Out of Stock
            </span>
          ) : discountPercent > 0 ? (
            <span className="bg-emerald-600 text-white font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-xs">
              {discountPercent}% OFF
            </span>
          ) : (
            <span />
          )}

          {isExcluded ? (
            <span className="bg-amber-600 text-white font-bold text-[9px] px-2 py-0.5 rounded-full shadow-xs">
              Price Regulated
            </span>
          ) : (
            <span className="bg-[#0F2C59]/90 text-[#D4AF37] font-extrabold text-[9px] px-2 py-0.5 rounded-full border border-[#D4AF37]/30">
              Wholesale Eligible
            </span>
          )}
        </div>

        {/* Top Header Row: Image at top-left, Product Name & Brand Name at top-right beside image */}
        <div className="px-3 pt-2 pb-1 flex items-start gap-3">
          {/* Top-Left: Product Image (exact same size) */}
          <div
            onClick={() => {
              if (product.imageUrl && product.imageUrl.trim()) {
                setIsZoomOpen(true);
              }
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && product.imageUrl && product.imageUrl.trim()) {
                e.preventDefault();
                setIsZoomOpen(true);
              }
            }}
            role={product.imageUrl && product.imageUrl.trim() ? 'button' : undefined}
            tabIndex={product.imageUrl && product.imageUrl.trim() ? 0 : undefined}
            aria-label={product.imageUrl && product.imageUrl.trim() ? `Zoom photo for ${product.name}` : undefined}
            title={product.imageUrl && product.imageUrl.trim() ? 'Tap to view full-size photo' : undefined}
            className={`relative w-[120px] sm:w-[130px] aspect-square max-w-[130px] max-h-[130px] shrink-0 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center shadow-xs group/img ${
              product.imageUrl && product.imageUrl.trim() ? 'cursor-pointer hover:border-[#0F2C59]/40 hover:shadow-sm' : ''
            }`}
          >
            {product.imageUrl && product.imageUrl.trim() ? (
              <>
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full h-full object-contain p-1 group-hover/img:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                <div
                  className="absolute bottom-1 right-1 bg-black/50 hover:bg-black/70 text-white p-1 rounded-md backdrop-blur-xs opacity-0 group-hover/img:opacity-100 transition-opacity duration-200 pointer-events-none shadow-xs"
                  aria-hidden="true"
                >
                  <ZoomIn size={11} />
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-2">
                <Package size={22} className="text-gray-300 stroke-[1.5]" />
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-1 text-center truncate max-w-full">
                  {product.brand || product.name}
                </span>
              </div>
            )}
          </div>

          {/* Top-Right: Product Name and Brand Name beside image */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-extrabold text-sm text-gray-900 line-clamp-2 leading-snug">
              {product.name}
            </h3>
            {product.brand ? (
              <div className="text-[11px] font-bold text-[#FF6B00] uppercase tracking-wider mt-1 truncate">
                {product.brand}
              </div>
            ) : null}
          </div>
        </div>

        {/* Content Details */}
        <div className="px-3 pb-3 pt-1">
          <p className="text-xs text-gray-500 line-clamp-2 mt-1 leading-relaxed">
            {product.description}
          </p>

          {/* Variant Selector Pills */}
          {product.variants.length > 1 && (
            <div className="mt-3">
              <span className="text-[10px] font-bold text-gray-500 block mb-1">Select Pack Size:</span>
              <div className="flex flex-wrap gap-1.5">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVariantId(v.id);
                      setHasRequested(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition border ${
                      v.id === currentVariant.id
                        ? 'bg-[#0F2C59] text-white border-[#0F2C59]'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {formatVariantPack(v)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Wholesale Quantity Tier Pricing Slab */}
          {currentVariant.tieredPrices && currentVariant.tieredPrices.length > 0 && (
            <div className="mt-3 bg-amber-50/70 border border-amber-200/80 rounded-xl p-2.5 text-[11px]">
              <div className="flex items-center gap-1 font-bold text-amber-900 mb-1">
                <Layers size={12} className="text-[#FF6B00]" />
                <span>Wholesale Quantity Slabs:</span>
              </div>
              <div className="space-y-0.5 text-gray-700">
                {currentVariant.tieredPrices.map((tier) => (
                  <div key={tier.id} className="flex justify-between items-center text-[10px]">
                    <span className="text-gray-600">
                      {tier.minQty}–{tier.maxQty} {currentVariant.unit}:
                    </span>
                    <span className="font-bold text-emerald-800">
                      ₹{tier.unitPrice} / {currentVariant.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        {/* Pricing & Add to Cart / Out of Stock Booking Footer */}
        {isOutOfStock ? (
          <div className="p-3.5 sm:p-4 pt-2 border-t border-gray-100 space-y-2">
            {/* Price and Out of Stock Badge Row */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-black text-[#0F2C59]">
                    ₹{Number.isInteger(currentPrice) ? currentPrice : currentPrice.toFixed(2)}
                  </span>
                  {currentVariant.mrp > currentPrice && (
                    <span className="text-xs text-gray-400 line-through">
                      ₹{Number.isInteger(currentVariant.mrp) ? currentVariant.mrp : currentVariant.mrp.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 font-medium">
                  Per {formatVariantPack(currentVariant)}
                </div>
              </div>

              {/* Clear Out of Stock Label */}
              <span className="text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200 shrink-0">
                Out of Stock
              </span>
            </div>

            {/* Book this Product Action Row - Fully visible on mobile screens, no horizontal overflow or clipping */}
            <div className="flex items-center gap-2 w-full">
              {/* Optional quantity selector for product request */}
              <div className="flex items-center bg-gray-100 rounded-xl p-0.5 border border-gray-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setRequestedQty((q) => Math.max(1, q - 1))}
                  className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-black hover:bg-white rounded-lg transition font-bold text-xs cursor-pointer"
                  title="Decrease requested quantity"
                  aria-label="Decrease requested quantity"
                >
                  <Minus size={12} />
                </button>
                <span className="w-6 text-center text-xs font-extrabold text-[#0F2C59]">
                  {requestedQty}
                </span>
                <button
                  type="button"
                  onClick={() => setRequestedQty((q) => q + 1)}
                  className="w-7 h-7 flex items-center justify-center text-gray-600 hover:text-black hover:bg-white rounded-lg transition font-bold text-xs cursor-pointer"
                  title="Increase requested quantity"
                  aria-label="Increase requested quantity"
                >
                  <Plus size={12} />
                </button>
              </div>

              {/* Book this Product Button */}
              <button
                id={`request-product-${currentVariant.id}`}
                type="button"
                onClick={handleRequestProduct}
                className="flex-1 min-w-0 bg-[#0F2C59] hover:bg-[#153e7d] text-white font-bold text-xs py-2 px-2.5 rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                title="Book this product when it becomes available"
              >
                <BellRing size={13} className="text-[#D4AF37] shrink-0" />
                <span className="truncate">Book this Product</span>
                {hasRequested && (
                  <span className="bg-emerald-500/25 text-emerald-300 text-[10px] px-1.5 py-0.2 rounded font-bold shrink-0 border border-emerald-400/40">
                    ✓ Saved
                  </span>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-black text-[#0F2C59]">
                  ₹{Number.isInteger(currentPrice) ? currentPrice : currentPrice.toFixed(2)}
                </span>
                {currentVariant.mrp > currentPrice && (
                  <span className="text-xs text-gray-400 line-through">
                    ₹{Number.isInteger(currentVariant.mrp) ? currentVariant.mrp : currentVariant.mrp.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 font-medium">
                Per {formatVariantPack(currentVariant)}
              </div>
              {isExcluded ? (
                <div className="text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-1.5 py-0.5 rounded mt-1 inline-block">
                  Price Regulated • Discount Excluded
                </div>
              ) : (
                <div className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 rounded mt-1 inline-block">
                  Online UPI: Save extra {settings.advancePaymentDiscountPct}%
                </div>
              )}
            </div>

            {/* Action Button Area */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {cartQuantity === 0 ? (
                <button
                  id={`add-to-cart-${currentVariant.id}`}
                  onClick={handleAdd}
                  className="bg-[#0F2C59] hover:bg-[#153e7d] text-white font-extrabold text-xs px-3.5 py-2 rounded-xl shadow-sm transition flex items-center gap-1.5 hover:scale-105"
                >
                  <Plus size={14} className="text-[#D4AF37]" />
                  <span>ADD</span>
                </button>
              ) : (
                <div className="flex items-center bg-[#0F2C59] text-white rounded-xl shadow-sm p-0.5">
                  <button
                    id={`cart-decrease-${currentVariant.id}`}
                    onClick={handleDecrement}
                    className="w-7 h-7 flex items-center justify-center hover:bg-white/20 rounded-lg transition"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-8 text-center text-xs font-black text-[#D4AF37]">
                    {cartQuantity}
                  </span>
                  <button
                    id={`cart-increase-${currentVariant.id}`}
                    onClick={handleIncrement}
                    disabled={cartQuantity >= Math.min(currentVariant.stockQuantity, currentVariant.maxOrderLimit)}
                    className="w-7 h-7 flex items-center justify-center hover:bg-white/20 rounded-lg transition disabled:opacity-40"
                    aria-label="Increase quantity"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notice displayed when customer requested an out of stock product */}
        {isOutOfStock && hasRequested && (
          <div className="px-4 pb-3">
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-2.5 text-[11px] text-amber-900 leading-snug">
              <div className="flex items-start gap-1.5">
                <AlertCircle size={14} className="text-amber-700 shrink-0 mt-0.5" />
                <p className="font-medium">
                  This product is currently out of stock. The price may change when it becomes available. The current price is not guaranteed.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {product.imageUrl && (
        <ImageLightboxModal
          isOpen={isZoomOpen}
          onClose={() => setIsZoomOpen(false)}
          imageUrl={product.imageUrl}
          title={product.name}
          subtitle={product.brand}
        />
      )}

      {/* Product Request Confirmation Modal */}
      <ProductRequestModal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        onAccept={() => {
          setHasRequested(true);
          setIsRequestModalOpen(false);
        }}
        onDecline={() => {
          setHasRequested(false);
          setIsRequestModalOpen(false);
        }}
        product={product}
        variant={currentVariant}
        quantity={requestedQty}
        requestDate={lastRequestDate}
        customerName={currentUser.name}
        customerPhone={currentUser.phone}
      />
    </div>
  );
};
