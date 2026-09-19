#!/usr/bin/env node
/**
 * Utility to generate an ADMIN_PASSWORD_HASH for .env configuration.
 * Usage:
 *   node scripts/generate-admin-hash.js "mySecurePassword"
 *   node scripts/generate-admin-hash.js --configure --silent
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const isSilent = process.argv.includes('--silent');
const shouldConfigure = process.argv.includes('--configure') || Boolean(process.env.ADMIN_SETUP_PASSWORD);
const explicitArg = process.argv.find(
  (arg, idx) => idx >= 2 && !arg.startsWith('--')
);
const password = explicitArg || process.env.ADMIN_SETUP_PASSWORD || process.env.ADMIN_PASSWORD;

if (!password || password.trim().length === 0) {
  console.error('Error: Please provide a password argument or configure ADMIN_SETUP_PASSWORD in environment.');
  console.error('Usage: node scripts/generate-admin-hash.js "YourPasswordHere"');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const derived = crypto.scryptSync(password.trim(), salt, 64).toString('hex');
const hashString = `${salt}:${derived}`;

if (shouldConfigure) {
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const hashLine = `ADMIN_PASSWORD_HASH="${hashString}"`;
  if (/^ADMIN_PASSWORD_HASH=.*/m.test(envContent)) {
    envContent = envContent.replace(/^ADMIN_PASSWORD_HASH=.*/m, hashLine);
  } else {
    envContent = envContent ? `${envContent.trim()}\n${hashLine}\n` : `${hashLine}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
}

if (isSilent) {
  console.log('SUCCESS: ADMIN_PASSWORD_HASH configured successfully.');
} else {
  console.log('\n--- Admin Password Hash Generated ---');
  if (shouldConfigure) {
    console.log('Successfully written to .env as ADMIN_PASSWORD_HASH.');
  } else {
    console.log('Set this in your environment or Settings menu:');
    console.log(`ADMIN_PASSWORD_HASH="${hashString}"\n`);
  }
}

