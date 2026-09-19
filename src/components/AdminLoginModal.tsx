import React, { useState, useEffect } from 'react';
import {
  Lock,
  AlertCircle,
  X,
  ArrowRight,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
  Eye,
  EyeOff,
  Phone,
  RefreshCw,
} from 'lucide-react';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'LOGIN' | 'FORGOT_PASSWORD';
}

type ModalMode = 'LOGIN' | 'RECOVERY_REQUEST' | 'RECOVERY_VERIFY' | 'SET_NEW_PASSWORD' | 'SUCCESS';

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'LOGIN',
}) => {
  const [mode, setMode] = useState<ModalMode>(initialMode);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Recovery state
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [challengeId, setChallengeId] = useState<string>('');
  const [maskedTarget, setMaskedTarget] = useState<string>('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [resetToken, setResetToken] = useState<string>('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode === 'FORGOT_PASSWORD' ? 'RECOVERY_REQUEST' : 'LOGIN');
      setPassword('');
      setError(null);
      setRecoveryIdentifier('');
      setRecoveryCode('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccessMessage('');
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  // 1. Submit Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter the Admin password');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.authenticated) {
        setError(data.error || 'Invalid credentials');
        return;
      }

      setPassword('');
      onSuccess();
    } catch {
      setError('Authentication service unavailable. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Request Password Recovery Challenge
  const handleRequestRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryIdentifier.trim()) {
      setError('Please enter your registered recovery mobile number or email.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryIdentifier: recoveryIdentifier.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Failed to initiate recovery.');
        return;
      }

      setChallengeId(data.challengeId || '');
      setMaskedTarget(data.maskedTarget || 'your registered contact');
      setMode('RECOVERY_VERIFY');
    } catch {
      setError('Recovery service unavailable. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Verify Recovery Code or Master Recovery Key
  const handleVerifyRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryCode.trim()) {
      setError('Please enter the 6-digit verification code or Master Recovery Key.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/verify-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          recoveryCode: recoveryCode.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.resetToken) {
        setError(data.error || 'Verification failed. Please try again.');
        return;
      }

      setResetToken(data.resetToken);
      setMode('SET_NEW_PASSWORD');
    } catch {
      setError('Verification service unavailable. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Set New Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) {
      setError('Please enter a new password.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetToken,
          newPassword: newPassword.trim(),
          confirmPassword: confirmPassword.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to update password.');
        return;
      }

      setSuccessMessage(
        data.message || 'Password has been reset successfully. Please log in with your new password.'
      );
      setMode('SUCCESS');
    } catch {
      setError('Password reset failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-[#0F2C59] p-6 text-white text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
          <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-3 border border-white/20">
            {mode === 'LOGIN' && <Lock className="text-[#D4AF37]" size={24} />}
            {(mode === 'RECOVERY_REQUEST' || mode === 'RECOVERY_VERIFY') && (
              <Phone className="text-[#D4AF37]" size={24} />
            )}
            {mode === 'SET_NEW_PASSWORD' && <KeyRound className="text-[#D4AF37]" size={24} />}
            {mode === 'SUCCESS' && <CheckCircle2 className="text-emerald-400" size={26} />}
          </div>

          <h3 className="text-xl font-bold">
            {mode === 'LOGIN' && 'Shopkeeper Verification'}
            {mode === 'RECOVERY_REQUEST' && 'Reset Admin Password'}
            {mode === 'RECOVERY_VERIFY' && 'Verify Recovery Code'}
            {mode === 'SET_NEW_PASSWORD' && 'Create New Password'}
            {mode === 'SUCCESS' && 'Password Updated!'}
          </h3>
          <p className="text-xs text-gray-300 mt-1">
            {mode === 'LOGIN' &&
              'Enter the store administrator credential to access management controls'}
            {mode === 'RECOVERY_REQUEST' &&
              'Confirm your registered administrator recovery contact'}
            {mode === 'RECOVERY_VERIFY' &&
              `Enter the 6-digit code dispatched to ${maskedTarget || 'your phone'}`}
            {mode === 'SET_NEW_PASSWORD' &&
              'Choose a secure password of at least 8 characters'}
            {mode === 'SUCCESS' && 'Your credentials have been securely refreshed'}
          </p>
        </div>

        {/* Dynamic Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-medium">
              <AlertCircle size={16} className="shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {/* VIEW 1: LOGIN */}
          {mode === 'LOGIN' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Admin Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="admin-password-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    disabled={isLoading}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F2C59] focus:bg-white transition pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                  <span>HttpOnly Cookie Session</span>
                </div>
                <button
                  type="button"
                  id="forgot-password-btn"
                  onClick={() => {
                    setError(null);
                    setMode('RECOVERY_REQUEST');
                  }}
                  className="text-xs font-bold text-[#0F2C59] hover:text-[#1a3d73] hover:underline"
                >
                  Forgot Password?
                </button>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 px-4 border border-gray-200 text-gray-600 font-bold rounded-xl text-xs hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 py-2.5 px-4 bg-[#0F2C59] hover:bg-[#1a3d73] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <span>Verifying...</span>
                  ) : (
                    <>
                      <span>Access Admin</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* VIEW 2: RECOVERY REQUEST */}
          {mode === 'RECOVERY_REQUEST' && (
            <form onSubmit={handleRequestRecovery} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  Recovery Mobile or Email
                </label>
                <input
                  type="text"
                  id="recovery-identifier-input"
                  value={recoveryIdentifier}
                  onChange={(e) => setRecoveryIdentifier(e.target.value)}
                  placeholder="e.g. 9876543210 or admin@domain.com"
                  disabled={isLoading}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F2C59] focus:bg-white transition"
                  autoFocus
                />
                <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                  Enter the registered mobile number (e.g. 9876543210) or recovery email for Om Distributors administrator.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('LOGIN');
                  }}
                  className="py-2.5 px-4 border border-gray-200 text-gray-600 font-bold rounded-xl text-xs hover:bg-gray-50 transition flex items-center gap-1"
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  type="submit"
                  id="submit-recovery-request-btn"
                  disabled={isLoading}
                  className="flex-1 py-2.5 px-4 bg-[#0F2C59] hover:bg-[#1a3d73] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <span>Dispatching...</span> : <span>Send Recovery Code</span>}
                </button>
              </div>
            </form>
          )}

          {/* VIEW 3: RECOVERY VERIFY */}
          {mode === 'RECOVERY_VERIFY' && (
            <form onSubmit={handleVerifyRecovery} className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Verification Code
                  </label>
                  <span className="text-[11px] text-gray-500">Valid for 5 mins</span>
                </div>
                <input
                  type="text"
                  id="recovery-code-input"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="Enter 6-digit code or Master Key"
                  disabled={isLoading}
                  maxLength={32}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-center text-lg font-mono font-bold tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F2C59] focus:bg-white transition"
                  autoFocus
                />
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Enter the verification code or your configured Master Recovery Key.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('RECOVERY_REQUEST');
                  }}
                  className="py-2.5 px-4 border border-gray-200 text-gray-600 font-bold rounded-xl text-xs hover:bg-gray-50 transition flex items-center gap-1"
                >
                  <ArrowLeft size={14} /> Resend
                </button>
                <button
                  type="submit"
                  id="submit-verify-code-btn"
                  disabled={isLoading}
                  className="flex-1 py-2.5 px-4 bg-[#0F2C59] hover:bg-[#1a3d73] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <span>Verifying...</span> : <span>Verify & Continue</span>}
                </button>
              </div>
            </form>
          )}

          {/* VIEW 4: SET NEW PASSWORD */}
          {mode === 'SET_NEW_PASSWORD' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    id="new-password-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    disabled={isLoading}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F2C59] focus:bg-white transition pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Confirm New Password
                </label>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  id="confirm-password-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  disabled={isLoading}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0F2C59] focus:bg-white transition"
                />
              </div>

              <div className="text-[11px] text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                • Minimum 8 characters required
                <br />
                • Passwords are encrypted with standard scrypt key derivation
                <br />• All prior sessions will be invalidated
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="submit"
                  id="submit-new-password-btn"
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 bg-[#0F2C59] hover:bg-[#1a3d73] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? <span>Updating Password...</span> : <span>Save New Password</span>}
                </button>
              </div>
            </form>
          )}

          {/* VIEW 5: SUCCESS CONFIRMATION */}
          {mode === 'SUCCESS' && (
            <div className="text-center space-y-4 py-2">
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 font-medium">
                {successMessage || 'Your new password has been stored securely.'}
              </div>

              <p className="text-xs text-gray-600">
                You can now log in to the Shopkeeper Admin Portal using your new password.
              </p>

              <button
                type="button"
                id="back-to-login-btn"
                onClick={() => {
                  setError(null);
                  setMode('LOGIN');
                }}
                className="w-full py-3 bg-[#0F2C59] hover:bg-[#1a3d73] text-white font-bold rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2"
              >
                <span>Proceed to Login</span>
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
