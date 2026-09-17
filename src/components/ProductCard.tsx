import React, { useState } from 'react';
import { Plus, Minus, Check, Layers, AlertCircle, Sparkles, Package } from 'lucide-react';
import { Product, ProductVariant } from '../types';
import { useApp } from '../context/AppContext';
import { getActiveUnitPrice } from '../lib/engine/checkout-calculator';
import { formatVariantPack } from '../utils/variantFormatter';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { cart, addToCart, updateCartQty } = useApp();
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    product.variants[0]?.id || ''
  );

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

  const isOutOfStock = currentVariant.stockQuantity <= 0;

  return (
    <div
      id={`product-card-${product.id}`}
      className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
    >
      <div>
        {/* Product Image & Badges */}
        <div className="relative h-44 bg-gray-100 overflow-hidden flex items-center justify-center">
          {product.imageUrl && product.imageUrl.trim() ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50/80">
              <Package size={36} className="text-gray-300 stroke-[1.5]" />
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-1.5">{product.brand}</span>
            </div>
          )}

          {/* Discount Badge */}
          {discountPercent > 0 && (
            <div className="absolute top-2.5 left-2.5 bg-emerald-600 text-white font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
              {discountPercent}% OFF
            </div>
          )}

          {/* Excluded from advance discount badge or wholesale badge */}
          {product.isDiscountExcluded ? (
            <div className="absolute top-2.5 right-2.5 bg-amber-500 text-white font-bold text-[9px] px-2 py-0.5 rounded-full shadow-sm">
              Regulated
            </div>
          ) : (
            <div className="absolute top-2.5 right-2.5 bg-[#0F2C59]/90 backdrop-blur-sm text-[#D4AF37] font-extrabold text-[9px] px-2 py-0.5 rounded-full border border-[#D4AF37]/30">
              Wholesale Eligible
            </div>
          )}
        </div>

        {/* Content Details */}
        <div className="p-4">
          <div className="text-[11px] font-bold text-[#FF6B00] uppercase tracking-wider mb-0.5">
            {product.brand}
          </div>
          <h3 className="font-extrabold text-sm text-gray-900 line-clamp-1 leading-snug">
            {product.name}
          </h3>
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
                    onClick={() => setSelectedVariantId(v.id)}
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

      {/* Pricing & Add to Cart Footer */}
      <div className="p-4 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-black text-[#0F2C59]">
              ₹{currentPrice}
            </span>
            {currentVariant.mrp > currentPrice && (
              <span className="text-xs text-gray-400 line-through">
                ₹{currentVariant.mrp}
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-500 font-medium">
            Per {formatVariantPack(currentVariant)}
          </div>
        </div>

        {/* Action Button */}
        <div>
          {isOutOfStock ? (
            <span className="text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200">
              Out of Stock
            </span>
          ) : cartQuantity === 0 ? (
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
    </div>
  );
};
