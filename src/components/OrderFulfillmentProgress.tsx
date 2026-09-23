import React, { useState } from 'react';
import {
  Clock,
  CheckCircle2,
  Package,
  PackageCheck,
  Truck,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { OrderStatus } from '../types';

export interface FulfillmentStepDef {
  key: string;
  status: OrderStatus;
  label: string;
  shortLabel: string;
  stepNumber: number;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}

export const SIX_FULFILLMENT_STEPS: FulfillmentStepDef[] = [
  {
    key: 'ORDER_PENDING',
    status: OrderStatus.ORDER_PENDING,
    label: 'Order Pending',
    shortLabel: 'Pending',
    stepNumber: 1,
    description: 'Order received and awaiting store confirmation.',
    icon: Clock,
  },
  {
    key: 'ORDER_ACCEPTED',
    status: OrderStatus.ORDER_ACCEPTED,
    label: 'Order Accepted',
    shortLabel: 'Accepted',
    stepNumber: 2,
    description: 'Store has accepted your order and queued it for packing.',
    icon: CheckCircle2,
  },
  {
    key: 'PACKING',
    status: OrderStatus.PACKING_IN_PROGRESS,
    label: 'Packing',
    shortLabel: 'Packing',
    stepNumber: 3,
    description: 'Wholesale team is packing and inspecting items.',
    icon: Package,
  },
  {
    key: 'READY',
    status: OrderStatus.READY_FOR_DELIVERY,
    label: 'Ready',
    shortLabel: 'Ready',
    stepNumber: 4,
    description: 'Order is sealed, verified, and staged for delivery.',
    icon: PackageCheck,
  },
  {
    key: 'ON_THE_WAY',
    status: OrderStatus.ON_THE_WAY,
    label: 'On The Way',
    shortLabel: 'On The Way',
    stepNumber: 5,
    description: 'Delivery driver is in transit to your address.',
    icon: Truck,
  },
  {
    key: 'DELIVERED',
    status: OrderStatus.DELIVERED,
    label: 'Delivered',
    shortLabel: 'Delivered',
    stepNumber: 6,
    description: 'Order delivered successfully to recipient.',
    icon: CheckCircle2,
  },
];

export function getFulfillmentStepIndex(status: string | OrderStatus): number {
  if (!status) return 0;
  const normalized = status.toString().trim().toUpperCase();

  switch (normalized) {
    case 'ORDER_PENDING':
    case 'PENDING':
    case 'ORDER PENDING':
      return 0;

    case 'ORDER_ACCEPTED':
    case 'ACCEPTED':
    case 'ORDER ACCEPTED':
      return 1;

    case 'PACKING_IN_PROGRESS':
    case 'PACKING':
    case 'PACKING IN PROGRESS':
      return 2;

    case 'READY_FOR_DELIVERY':
    case 'READY':
    case 'READY FOR DELIVERY':
      return 3;

    case 'ON_THE_WAY':
    case 'ON THE WAY':
    case 'OUT_FOR_DELIVERY':
    case 'DISPATCHED':
    case 'SHIPPED':
      return 4;

    case 'DELIVERED':
      return 5;

    case 'CANCELLED':
      return -1;

    default:
      return 1;
  }
}

interface OrderFulfillmentProgressProps {
  status: OrderStatus | string;
  orderNumber?: string;
  className?: string;
  showDetailsToggle?: boolean;
}

export const OrderFulfillmentProgress: React.FC<OrderFulfillmentProgressProps> = ({
  status,
  orderNumber,
  className = '',
  showDetailsToggle = true,
}) => {
  const [showVerticalBreakdown, setShowVerticalBreakdown] = useState(false);

  const currentStepIndex = getFulfillmentStepIndex(status);
  const isCancelled = currentStepIndex === -1 || status === OrderStatus.CANCELLED;
  const isDelivered = currentStepIndex === 5 || status === OrderStatus.DELIVERED;

  // Percentage for progress bar: 5 intervals between 6 nodes (0%, 20%, 40%, 60%, 80%, 100%)
  const progressPercent =
    currentStepIndex <= 0 ? 0 : Math.min(100, Math.round((currentStepIndex / 5) * 100));

  const currentStep =
    currentStepIndex >= 0 && currentStepIndex < SIX_FULFILLMENT_STEPS.length
      ? SIX_FULFILLMENT_STEPS[currentStepIndex]
      : null;

  if (isCancelled) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-2xl p-4 text-red-900 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-red-700 bg-red-100/80 px-2 py-0.5 rounded">
                Order Cancelled
              </span>
              {orderNumber && (
                <span className="text-xs text-red-600 font-mono">#{orderNumber}</span>
              )}
            </div>
            <p className="text-xs text-red-800 mt-1">
              This order has been cancelled and fulfillment progress is halted. If any online payment was made, the amount has been credited back to your account or Store Wallet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      id="order-fulfillment-progress"
      className={`bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden ${className}`}
    >
      {/* Header bar */}
      <div className="px-4 py-3 bg-gradient-to-r from-gray-50 via-white to-gray-50 border-b border-gray-200/80 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h3 className="text-xs font-black text-[#0F2C59] tracking-wide uppercase">
            Order Fulfillment Progress
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
              isDelivered
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-orange-100 text-[#FF6B00] border border-orange-300'
            }`}
          >
            Step {currentStepIndex + 1} of 6: {currentStep?.label}
          </span>
        </div>
      </div>

      {/* Main 6-Step Horizontal Progress Timeline */}
      <div className="p-4 sm:p-5">
        <div className="relative pb-2">
          {/* Background Track Line */}
          <div className="absolute top-[16px] sm:top-[18px] left-[8%] right-[8%] h-1.5 bg-gray-200 rounded-full z-0" />

          {/* Active Fill Track Line */}
          <div
            className="absolute top-[16px] sm:top-[18px] left-[8%] h-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full z-0 transition-all duration-700 ease-out"
            style={{ width: `${Math.max(0, (progressPercent * 0.84))}%` }}
          />

          {/* 6 Step Nodes */}
          <div className="relative z-10 grid grid-cols-6 gap-1">
            {SIX_FULFILLMENT_STEPS.map((step, idx) => {
              const isCompleted = idx < currentStepIndex || (idx === 5 && isDelivered);
              const isCurrent = idx === currentStepIndex && !isDelivered;
              const isUpcoming = idx > currentStepIndex;
              const StepIcon = step.icon;

              return (
                <div
                  key={step.key}
                  className="flex flex-col items-center text-center group cursor-default"
                >
                  {/* Step Node Circle */}
                  <div
                    className={`relative w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${
                      isCompleted
                        ? 'bg-emerald-600 text-white shadow-xs border-2 border-emerald-600'
                        : isCurrent
                        ? 'bg-[#0F2C59] text-[#D4AF37] ring-4 ring-[#0F2C59]/15 shadow-md scale-110 border-2 border-[#D4AF37]'
                        : 'bg-white text-gray-400 border-2 border-gray-300'
                    }`}
                    title={`Step ${step.stepNumber}: ${step.label} - ${
                      isCompleted ? 'Completed' : isCurrent ? 'Current Status' : 'Upcoming'
                    }`}
                  >
                    {isCompleted ? (
                      <Check size={16} strokeWidth={3} className="text-white" />
                    ) : isCurrent ? (
                      <StepIcon size={16} strokeWidth={2.5} className="animate-pulse" />
                    ) : (
                      <span className="text-[11px] sm:text-xs font-bold text-gray-400">
                        {step.stepNumber}
                      </span>
                    )}

                    {/* Ping effect for current active step */}
                    {isCurrent && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#FF6B00] border-2 border-white animate-ping" />
                    )}
                  </div>

                  {/* Step Label (Exact 6 names) */}
                  <div className="mt-2 flex flex-col items-center">
                    <span
                      className={`text-[9px] sm:text-[11px] font-bold leading-tight px-0.5 ${
                        isCompleted
                          ? 'text-emerald-900 font-extrabold'
                          : isCurrent
                          ? 'text-[#0F2C59] font-black'
                          : 'text-gray-400 font-medium'
                      }`}
                    >
                      {step.label}
                    </span>

                    {/* Step Status Pill */}
                    <div className="mt-1">
                      {isCompleted ? (
                        <span className="inline-flex items-center text-[8px] sm:text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded">
                          Done
                        </span>
                      ) : isCurrent ? (
                        <span className="inline-flex items-center text-[8px] sm:text-[9px] font-black text-white bg-[#FF6B00] px-1.5 py-0.2 rounded-full shadow-2xs uppercase tracking-tighter">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[8px] sm:text-[9px] text-gray-400">
                          Wait
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current Active Status Card */}
        {currentStep && (
          <div
            className={`mt-4 p-3.5 rounded-xl border flex items-start gap-3 transition-colors ${
              isDelivered
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-blue-50/70 border-blue-200 text-blue-950'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isDelivered
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-[#0F2C59] text-[#D4AF37] shadow-xs'
              }`}
            >
              {isDelivered ? <CheckCircle2 size={20} /> : <currentStep.icon size={20} />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500">
                  Current Status • Step {currentStep.stepNumber} of 6
                </span>
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    isDelivered ? 'bg-emerald-200 text-emerald-900' : 'bg-orange-100 text-[#FF6B00]'
                  }`}
                >
                  {currentStep.label}
                </span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-gray-900 mt-0.5">
                {currentStep.description}
              </p>
            </div>
          </div>
        )}

        {/* Optional Toggle to show full vertical step breakdown */}
        {showDetailsToggle && (
          <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
            <button
              type="button"
              id="btn-toggle-fulfillment-details"
              onClick={() => setShowVerticalBreakdown(!showVerticalBreakdown)}
              className="text-[#0F2C59] hover:text-[#FF6B00] font-bold text-[11px] flex items-center gap-1 transition"
            >
              <span>{showVerticalBreakdown ? 'Hide Step Details' : 'View All 6 Step Descriptions'}</span>
              {showVerticalBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <span className="text-[10px] text-gray-400">
              Auto-syncs with store operations
            </span>
          </div>
        )}

        {/* Collapsible Vertical Breakdown for detailed review */}
        {showVerticalBreakdown && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2.5 animate-in fade-in duration-200">
            {SIX_FULFILLMENT_STEPS.map((step, idx) => {
              const isCompleted = idx < currentStepIndex || (idx === 5 && isDelivered);
              const isCurrent = idx === currentStepIndex && !isDelivered;
              const StepIcon = step.icon;

              return (
                <div
                  key={step.key}
                  className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                    isCompleted
                      ? 'bg-emerald-50/50 border-emerald-200'
                      : isCurrent
                      ? 'bg-amber-50/60 border-amber-300 ring-1 ring-amber-300'
                      : 'bg-gray-50/40 border-gray-200 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        isCompleted
                          ? 'bg-emerald-600 text-white'
                          : isCurrent
                          ? 'bg-[#0F2C59] text-[#D4AF37]'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted ? (
                        <Check size={12} strokeWidth={3} />
                      ) : (
                        <span className="text-[10px] font-bold">{step.stepNumber}</span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-gray-900">{step.label}</span>
                        {isCurrent && (
                          <span className="text-[9px] font-black text-white bg-[#FF6B00] px-1.5 rounded-full uppercase">
                            Current
                          </span>
                        )}
                        {isCompleted && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1 rounded">
                            Completed
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">{step.description}</p>
                    </div>
                  </div>

                  <StepIcon
                    size={16}
                    className={`shrink-0 ${
                      isCompleted
                        ? 'text-emerald-600'
                        : isCurrent
                        ? 'text-[#0F2C59]'
                        : 'text-gray-400'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
