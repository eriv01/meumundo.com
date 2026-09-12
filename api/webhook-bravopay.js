// /api/webhook-bravopay.js
import crypto from 'crypto';
import { kv } from '@vercel/kv';

// Precisamos do corpo CRU (não parseado) para validar a assinatura HMAC
export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyWebhook(rawBody, headerValue, secret, toleranceSec = 300) {
  if (!headerValue) return false;
  const parts = Object.fromEntries(
    headerValue.split(',').map((kv) => kv.split('='))
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // anti-replay

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false; // tamanhos diferentes, por exemplo
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const secret = process.env.BRAVOPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('BRAVOPAY_WEBHOOK_SECRET não configurado');
    return res.status(500).json({ error: 'Webhook secret não configurado' });
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['bravopay-signature'] || req.headers['x-bravopay-signature'];

  if (!verifyWebhook(rawBody, signature, secret)) {
    return res.status(401).json({ error: 'Assinatura inválida' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  // Dedupe: o id do evento é estável entre retentativas
  const dedupeKey = `evt:${event.id}`;
  const alreadyProcessed = await kv.get(dedupeKey);
  if (alreadyProcessed) {
    return res.status(200).json({ received: true, deduped: true });
  }
  await kv.set(dedupeKey, true, { ex: 86400 });

  const tx = event.data;

  if (event.type === 'transaction.paid') {
    await kv.set(`pix:${tx.id}`, { status: 'approved', paid_at: tx.paid_at }, { ex: 2400 });
  } else if (event.type === 'transaction.expired') {
    await kv.set(`pix:${tx.id}`, { status: 'expired' }, { ex: 2400 });
  } else if (event.type === 'transaction.refunded' || event.type === 'transaction.chargeback') {
    await kv.set(`pix:${tx.id}`, { status: event.type.split('.')[1] }, { ex: 2400 });
  }

  // Responda rápido — a BravoPay tenta de novo se não vier 2xx em <5s
  return res.status(200).json({ received: true });
}
