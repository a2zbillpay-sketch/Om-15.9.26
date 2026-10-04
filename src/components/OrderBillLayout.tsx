import React from 'react';
import { Order, PaymentMethod, PaymentStatus } from '../types';

export interface OrderBillLayoutProps {
  order: Order;
  settings?: any;
}

export const OrderBillLayout: React.FC<OrderBillLayoutProps> = ({ order, settings }) => {
  const isAdvance =
    order.paymentMethod === PaymentMethod.ADVANCE_ONLINE ||
    order.paymentStatus === PaymentStatus.RECEIVED;

  const totalItemCount = order.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
  const formattedOrderDate = new Date(order.createdAt).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div
      id="printable-order-bill"
      className="bg-white p-6 sm:p-8 rounded-xl border border-gray-200 shadow-xs max-w-2xl mx-auto text-gray-900 text-xs"
    >
      {/* Header: Store Branding */}
      <div className="text-center border-b-2 border-[#0F2C59] pb-3 mb-4">
        <h1 className="text-xl sm:text-2xl font-black text-[#0F2C59] tracking-wide uppercase">
          {settings?.storeName || 'OM DISTRIBUTORS'}
        </h1>
        <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider mt-0.5">
          Grocery Wholesale & Direct Retail • Nashik, Maharashtra
        </p>
        <p className="text-[10px] text-gray-500 mt-0.5">
          Home Delivery within Nashik City • Contact: +91 9822000000
        </p>
        <div className="mt-2">
          <span className="inline-block bg-[#0F2C59] text-white text-[11px] font-black uppercase px-3 py-0.5 rounded tracking-wider">
            Tax Invoice / Cash Memo
          </span>
        </div>
      </div>

      {/* Meta Information Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-xs">
        {/* Order Details */}
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
          <div className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Order Details
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Invoice No:</span>
            <span className="font-mono font-bold text-[#0F2C59]">#{order.orderNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Order Date:</span>
            <span className="font-semibold text-gray-800">{formattedOrderDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Delivery Date:</span>
            <span className="font-semibold text-gray-800">{order.deliveryDate || 'Standard Delivery'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Order Status:</span>
            <span className="font-bold uppercase text-[10px] text-gray-800">
              {order.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Customer & Delivery Address Details */}
        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1">
          <div className="text-[10px] font-extrabold text-gray-500 uppercase tracking-wider">
            Customer & Delivery Details
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Customer Name:</span>
            <span className="font-bold text-gray-900">{order.userName || 'Valued Customer'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Mobile Phone:</span>
            <span className="font-mono font-bold text-gray-800">+91 {order.userPhone}</span>
          </div>
          <div className="pt-0.5">
            <span className="text-gray-600 font-medium block">Delivery Address:</span>
            <span className="font-semibold text-gray-800 block text-[11px] leading-tight">
              {order.address?.fullAddress || 'Store Pickup / Address not specified'}
              {order.address?.pincode ? ` - ${order.address.pincode}` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Payment Summary Header Row */}
      <div className="bg-gray-100/80 p-2.5 rounded-lg border border-gray-200 flex flex-wrap items-center justify-between gap-2 mb-4 text-xs font-semibold">
        <div>
          <span className="text-gray-600">Payment Mode: </span>
          <span className="font-extrabold text-gray-900">
            {order.paymentMethod === PaymentMethod.ADVANCE_ONLINE ? 'UPI Advance Payment' : 'Cash on Delivery (COD)'}
          </span>
        </div>
        <div>
          <span className="text-gray-600">Payment Status: </span>
          <span className="font-bold text-emerald-800">
            {isAdvance ? 'PAID ONLINE (ADVANCE)' : (order.codCollectedAmount && order.codCollectedAmount > 0) ? 'COD COLLECTED' : 'PAYABLE ON DELIVERY'}
          </span>
        </div>
      </div>

      {/* Items Table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full border-collapse border border-gray-300 text-xs">
          <thead>
            <tr className="bg-gray-100 text-gray-800 font-extrabold text-[11px] uppercase">
              <th className="border border-gray-300 p-2 text-center w-8">#</th>
              <th className="border border-gray-300 p-2 text-left">Item Description</th>
              <th className="border border-gray-300 p-2 text-center w-24">Pack Size</th>
              <th className="border border-gray-300 p-2 text-center w-16">Qty</th>
              <th className="border border-gray-300 p-2 text-right w-20">Rate (₹)</th>
              <th className="border border-gray-300 p-2 text-right w-24">Amount (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-gray-800">
            {order.items.map((item, idx) => (
              <tr key={item.id || idx} className="hover:bg-gray-50/50">
                <td className="border border-gray-300 p-2 text-center font-mono text-gray-500">
                  {idx + 1}
                </td>
                <td className="border border-gray-300 p-2 font-bold text-gray-900">
                  <div>
                    <span>{item.productName}</span>
                    {item.brand && (
                      <span className="text-[10px] text-gray-500 font-normal ml-1">
                        ({item.brand})
                      </span>
                    )}
                    {item.isDiscountExcluded && (
                      <span className="ml-1 text-[9px] bg-amber-100 text-amber-900 px-1 rounded font-semibold border border-amber-200">
                        Price Regulated
                      </span>
                    )}
                  </div>
                </td>
                <td className="border border-gray-300 p-2 text-center text-gray-700">
                  {item.packSize ? `${item.packSize} ${item.unit || ''}` : item.variantName || 'Standard'}
                </td>
                <td className="border border-gray-300 p-2 text-center font-bold font-mono">
                  {item.quantity}
                </td>
                <td className="border border-gray-300 p-2 text-right font-mono text-gray-700">
                  ₹{item.unitPrice}
                </td>
                <td className="border border-gray-300 p-2 text-right font-mono font-bold text-gray-900">
                  ₹{item.price}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom Calculations & Terms */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-1">
        {/* Summary Notes / Policy */}
        <div className="flex-1 bg-gray-50 p-3 rounded-lg border border-dashed border-gray-300 text-[10px] text-gray-600 space-y-1">
          <div className="font-bold text-gray-800 uppercase tracking-wide">
            Order Summary:
          </div>
          <p>• Total Unique Products: <strong>{order.items.length}</strong> items</p>
          <p>• Total Quantity Ordered: <strong>{totalItemCount}</strong> units</p>
          <p>• Clean wholesale packaging assured. Direct from Mandi.</p>
          <p>• 15-minute cancellation window policy applied at order placement.</p>
        </div>

        {/* Totals Table */}
        <div className="w-full sm:w-72 bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-1.5 text-xs">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal (Item Total):</span>
            <span className="font-semibold text-gray-900 font-mono">₹{order.subtotal}</span>
          </div>

          {order.discountAmount > 0 && (
            <div className="flex justify-between text-emerald-700 font-bold">
              <span>Advance UPI Discount:</span>
              <span className="font-mono">-₹{order.discountAmount}</span>
            </div>
          )}

          <div className="flex justify-between text-gray-600">
            <span>Delivery Charges:</span>
            <span className="font-semibold text-gray-900 font-mono">
              {order.deliveryFee === 0 ? 'FREE' : `₹${order.deliveryFee}`}
            </span>
          </div>

          {order.codCharge > 0 && (
            <div className="flex justify-between text-amber-800">
              <span>COD Convenience Charge:</span>
              <span className="font-semibold font-mono">+₹{order.codCharge}</span>
            </div>
          )}

          {/* Grand Order Bill Total */}
          <div className="flex justify-between text-sm font-black text-[#0F2C59] border-t-2 border-[#0F2C59] pt-2 mt-1">
            <span>Total Order Bill:</span>
            <span className="font-mono">₹{order.finalAmount}</span>
          </div>

          {/* COD Ledger Details if present */}
          {order.paymentMethod === PaymentMethod.COD && order.previousOutstanding !== undefined && order.previousOutstanding > 0 && (
            <>
              <div className="flex justify-between text-amber-900 font-medium pt-1 border-t border-gray-200">
                <span>Previous Outstanding:</span>
                <span className="font-mono">+₹{order.previousOutstanding}</span>
              </div>
              <div className="flex justify-between text-[#0F2C59] font-black text-xs">
                <span>Total Payable on Delivery:</span>
                <span className="font-mono">₹{order.totalPayable || order.finalAmount}</span>
              </div>
            </>
          )}

          {order.codCollectedAmount !== undefined && order.codCollectedAmount > 0 && (
            <div className="flex justify-between text-emerald-700 font-bold pt-1 border-t border-gray-200">
              <span>Amount Collected:</span>
              <span className="font-mono">₹{order.codCollectedAmount}</span>
            </div>
          )}

          {order.walletAmountUsed !== undefined && order.walletAmountUsed > 0 && (
            <div className="flex justify-between text-emerald-700 font-bold pt-1">
              <span>Wallet Applied:</span>
              <span className="font-mono">-₹{order.walletAmountUsed}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bill Footer & Signature */}
      <div className="mt-8 pt-4 border-t border-dashed border-gray-300 flex justify-between items-end text-[10px] text-gray-500">
        <div>
          <p className="font-bold text-gray-700">Thank you for ordering with Om Distributors!</p>
          <p>Computer generated invoice. No signature required for delivery.</p>
        </div>
        <div className="text-center">
          <div className="w-28 border-b border-gray-400 mb-1"></div>
          <span className="font-bold text-gray-700">Authorized Signatory</span>
        </div>
      </div>
    </div>
  );
};
