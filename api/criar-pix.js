// /api/criar-pix.js
import { kv } from '@vercel/kv';

const PRECO_BASE = 12.90;
const PRECO_BUMP1 = 4.97;
const PRECO_BUMP2 = 4.97;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const { nome, email, bump1, bump2 } = req.body;

    if (!nome || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    }

    const API_KEY = process.env.BRAVOPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'BRAVOPAY_API_KEY não configurada' });

    const totalAmount = parseFloat(
      (PRECO_BASE + (bump1 ? PRECO_BUMP1 : 0) + (bump2 ? PRECO_BUMP2 : 0)).toFixed(2)
    );
    const amountCents = Math.round(totalAmount * 100);

    const produtos = ['Método Tripê'];
    if (bump1) produtos.push('Método Bicarbonato');
    if (bump2) produtos.push('força Máximo');

    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

    const response = await fetch('https://bravopay.club/api/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        amount_cents: amountCents,
        method: 'pix',
        customer: {
          email,
          name: nome,
        },
        description: produtos.join(' + '),
        external_reference: idempotencyKey,
        expires_in: 1800, // 30 minutos
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Erro BravoPay:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Erro ao gerar PIX. Tente novamente.',
        details: data,
      });
    }

    if (!data.pix?.copy_paste) {
      return res.status(500).json({ error: 'Resposta sem dados de PIX' });
    }

    // Guarda status inicial no KV — TTL um pouco maior que o expires_in do PIX
    await kv.set(`pix:${data.id}`, { status: 'pending' }, { ex: 2400 });

    return res.status(200).json({
      id: data.id,
      status: 'pending',
      qr_code: data.pix.copy_paste,
      total: totalAmount,
      produtos,
    });
  } catch (err) {
    console.error('Erro criar-pix:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
