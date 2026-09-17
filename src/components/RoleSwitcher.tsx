import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { AdminLoginModal } from './AdminLoginModal';

export const RoleSwitcher: React.FC = () => {
  const { activeRole, setActiveRole, isAdminSessionValid, checkAdminSession } = useApp();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const roles: { role: Role; label: string }[] = [
    { role: Role.CUSTOMER, label: 'Customer View' },
    { role: Role.SHOPKEEPER, label: 'Shopkeeper Admin' },
  ];

  const handleRoleClick = async (role: Role) => {
    if (role === Role.SHOPKEEPER) {
      // Must verify server session before activating Shopkeeper UI
      const isValid = isAdminSessionValid || (await checkAdminSession());
      if (!isValid) {
        setIsLoginModalOpen(true);
        return;
      }
    }

    setActiveRole(role);
  };

  return (
    <>
      <div className="bg-[#0B1E3B] border-b border-white/10 px-4 py-1.5 flex justify-between items-center text-xs text-white">
        <span className="font-semibold tracking-wide text-gray-300">PORTAL:</span>
        <div className="flex gap-2">
          {roles.map((r) => (
            <button
              key={r.role}
              onClick={() => handleRoleClick(r.role)}
              className={`px-3 py-1 rounded-full font-medium transition-all ${
                activeRole === r.role
                  ? 'bg-[#D4AF37] text-[#0F2C59] font-bold shadow-sm'
                  : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <AdminLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={() => {
          setIsLoginModalOpen(false);
          setActiveRole(Role.SHOPKEEPER);
        }}
      />
    </>
  );
};
