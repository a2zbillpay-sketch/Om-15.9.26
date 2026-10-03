import React from 'react';
import { X, Printer, CheckCircle2, MapPin, Phone, Calendar, Package, FileText, Check } from 'lucide-react';
import { Order, OrderStatus, PaymentMethod, PaymentStatus } from '../types';
import { useApp } from '../context/AppContext';

export interface BillPrintModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
}

export const BillPrintModal: React.FC<BillPrintModalProps> = ({
  order,
  isOpen,
  onClose,
}) => {
  const { settings } = useApp();

  if (!isOpen || !order) return null;

  const handlePrint = () => {
    const printContent = document.getElementById('printable-order-bill');
    if (!printContent) {
      window.print();
      return;
    }

    // Use a clean hidden iframe to print without triggering popup blockers
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Bill_${order.orderNumber}_OmDistributors</title>
            <style>
              @page { size: auto; margin: 8mm; }
              * { box-sizing: border-box; }
              body {
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                margin: 0;
                color: #111827;
                font-size: 12px;
                line-height: 1.4;
                background: #fff;
              }
              .bill-wrapper { max-width: 780px; margin: 0 auto; padding: 12px; }
              .header { text-align: center; border-bottom: 2px solid #0F2C59; padding-bottom: 8px; margin-bottom: 12px; }
              .store-name { font-size: 22px; font-weight: 900; color: #0F2C59; margin: 0; letter-spacing: 0.5px; }
              .store-sub { font-size: 10px; color: #4B5563; font-weight: 700; text-transform: uppercase; margin-top: 2px; }
              .badge-title { display: inline-block; font-size: 11px; font-weight: 900; background: #0F2C59; color: #fff; padding: 2px 12px; border-radius: 4px; margin-top: 6px; letter-spacing: 0.5px; }
              .info-grid { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
              .info-card { flex: 1; border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 10px; background: #F9FAFB; font-size: 11px; }
              .info-card h4 { margin: 0 0 4px 0; font-size: 10px; color: #6B7280; text-transform: uppercase; font-weight: 800; }
              table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 12px; font-size: 11px; }
              th, td { border: 1px solid #D1D5DB; padding: 6px 8px; text-align: left; }
              th { background: #F3F4F6; font-weight: 800; color: #374151; font-size: 10px; text-transform: uppercase; }
              .text-right { text-align: right; }
              .text-center { text-align: center; }
              .font-bold { font-weight: bold; }
              .summary-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-top: 8px; }
              .notes-box { flex: 1; font-size: 10px; color: #4B5563; border: 1px dashed #D1D5DB; padding: 8px; border-radius: 6px; }
              .totals-box { width: 280px; font-size: 11px; }
              .tot-line { display: flex; justify-content: space-between; padding: 3px 0; }
              .grand-line { border-top: 2px solid #0F2C59; font-size: 14px; font-weight: 900; color: #0F2C59; padding-top: 6px; margin-top: 4px; }
              .footer { text-align: center; margin-top: 18px; padding-top: 8px; border-top: 1px dashed #9CA3AF; font-size: 10px; color: #6B7280; }
            </style>
          </head>
          <body>
            <div class="bill-wrapper">
              ${printContent.innerHTML}
            </div>
          </body>
        </html>
      `);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }

    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {}
    }, 1500);
  };

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
      id="bill-print-modal-overlay"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fadeIn"
    >
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden border border-gray-300 my-auto flex flex-col max-h-[94vh]">
        {/* Modal Top Actions Bar */}
        <div className="bg-[#0F2C59] text-white px-5 py-3.5 flex items-center justify-between shrink-0 border-b border-[#D4AF37]/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4AF37] text-[#0F2C59] flex items-center justify-center font-black">
              <Printer size={16} />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white flex items-center gap-2">
                <span>Order Bill & Tax Invoice</span>
                <span className="font-mono text-xs text-[#D4AF37] bg-white/10 px-2 py-0.5 rounded border border-[#D4AF37]/30">
                  #{order.orderNumber}
                </span>
              </h3>
              <p className="text-[10px] text-gray-300">
                Official shopkeeper retail & wholesale cash memo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-trigger-print"
              onClick={handlePrint}
              className="bg-[#FF6B00] hover:bg-[#e05e00] text-white text-xs font-black px-4 py-2 rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer active:scale-95"
              title="Print bill on thermal or standard printer"
            >
              <Printer size={14} />
              <span>Print Bill</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Close bill preview"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Bill Content / Preview */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50/50">
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
        </div>

        {/* Modal Bottom Action Bar */}
        <div className="bg-gray-100 px-5 py-3 border-t border-gray-200 flex justify-between items-center shrink-0">
          <span className="text-xs text-gray-500 font-medium">
            Format: Standard A4 / Thermal Compatible Receipt
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-gray-200 text-gray-700 border border-gray-300 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2 bg-[#0F2C59] hover:bg-[#163a6e] text-white text-xs font-extrabold rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer"
            >
              <Printer size={14} className="text-[#D4AF37]" />
              <span>Print Bill</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
