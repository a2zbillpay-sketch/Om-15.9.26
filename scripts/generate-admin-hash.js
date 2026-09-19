#!/usr/bin/env node
/**
 * Utility to generate an ADMIN_PASSWORD_HASH for .env configuration.
 * Usage:
 *   node scripts/generate-admin-hash.js "mySecurePassword"
 */
import crypto from 'crypto';

const password = process.argv[2];

if (!password || password.trim().length === 0) {
  console.error('Error: Please provide a password argument.');
  console.error('Usage: node scripts/generate-admin-hash.js "YourPasswordHere"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const derived = crypto.scryptSync(password.trim(), salt, 64).toString('hex');
const hashString = `${salt}:${derived}`;

console.log('\n--- Admin Password Hash Generated ---');
console.log('Set this in your environment or Settings menu:');
console.log(`ADMIN_PASSWORD_HASH="${hashString}"\n`);
