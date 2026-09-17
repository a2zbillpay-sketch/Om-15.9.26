import type { IncomingMessage, ServerResponse } from 'http';
import { verifyAdminSession } from './verify.ts';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Allow', 'GET');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const session = verifyAdminSession(req);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');

  if (session && session.role === 'SHOPKEEPER') {
    res.end(
      JSON.stringify({
        authenticated: true,
        role: 'SHOPKEEPER',
      })
    );
  } else {
    res.end(
      JSON.stringify({
        authenticated: false,
      })
    );
  }
}
