import type { IncomingMessage, ServerResponse } from 'http';

interface StoredLoginEvent {
  id: string;
  customerName: string;
  phone: string;
  loginTime: string;
  timestamp: number;
}

// In-memory queue of recent customer logins (retains last 100 events)
const recentCustomerLogins: StoredLoginEvent[] = [];

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET') {
    const sinceParam = url.searchParams.get('since');
    const since = sinceParam ? Number(sinceParam) : 0;

    const filtered = !Number.isNaN(since) && since > 0
      ? recentCustomerLogins.filter((item) => item.timestamp > since)
      : recentCustomerLogins.slice(-20);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, logins: filtered }));
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const customerName = String(body.customerName || 'Valued Customer').trim();
      const phone = String(body.phone || '').trim();
      const loginTime = String(body.loginTime || new Date().toLocaleTimeString()).trim();
      const timestamp = Number(body.timestamp) || Date.now();
      const id = String(body.id || `login-${timestamp}-${Math.random().toString(36).slice(2, 7)}`);

      const newEvent: StoredLoginEvent = {
        id,
        customerName,
        phone,
        loginTime,
        timestamp,
      };

      // Add to front of queue
      recentCustomerLogins.unshift(newEvent);
      if (recentCustomerLogins.length > 100) {
        recentCustomerLogins.length = 100;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, event: newEvent }));
      return;
    } catch (err: any) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'Invalid request' }));
      return;
    }
  }

  res.statusCode = 405;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
}
