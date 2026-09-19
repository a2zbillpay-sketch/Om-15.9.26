async function testHttpAuth() {
  const base = 'http://localhost:3000';

  console.log('1. Checking unauthenticated /api/auth/me...');
  let res = await fetch(`${base}/api/auth/me`);
  let data = await res.json();
  console.log('Unauthenticated me:', res.status, data);
  if (data.authenticated !== false) {
    throw new Error('Initial session should not be authenticated');
  }

  console.log('\n2. Requesting password reset OTP for 8668912656...');
  res = await fetch(`${base}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryIdentifier: '8668912656' }),
  });
  data = await res.json();
  console.log('Forgot password response:', res.status, data);
  if (!data.success || !data.challengeId) {
    throw new Error('Expected success and challengeId');
  }
  const challengeId = data.challengeId;

  console.log('\n3. Testing incorrect recovery code...');
  res = await fetch(`${base}/api/auth/verify-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, recoveryCode: '000000' }),
  });
  data = await res.json();
  console.log('Incorrect code response:', res.status, data);
  if (res.status !== 400 || !data.error) {
    throw new Error('Expected 400 for incorrect code');
  }

  console.log('\n4. Testing password reset endpoint directly without valid token...');
  res = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resetToken: 'invalid-token-1234567890',
      newPassword: 'SecurePassword#2026',
      confirmPassword: 'SecurePassword#2026',
    }),
  });
  data = await res.json();
  console.log('Invalid token response:', res.status, data);
  if (res.status !== 400) {
    throw new Error('Expected 400 for invalid reset token');
  }

  console.log('\n=======================================');
  console.log('HTTP SECURITY & AUTH CHECKS CONFIRMED!');
  console.log('=======================================');
}

testHttpAuth().catch((err) => {
  console.error('HTTP Test Error:', err);
  process.exit(1);
});
