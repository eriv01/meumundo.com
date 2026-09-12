// /api/status-pix.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });

    const data = await kv.get(`pix:${id}`);

    if (!data) {
      // Ainda não recebemos webhook, ou o registro expirou
      return res.status(200).json({ id, status: 'pending' });
    }

    return res.status(200).json({ id, status: data.status });
  } catch (err) {
    console.error('Erro status-pix:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
