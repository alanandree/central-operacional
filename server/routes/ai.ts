import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, authRequired, companyId } from '../core.ts';
import { all, one } from '../db.ts';
import { aiStatus, callAIJson, callAIText } from '../integrations.ts';

export const aiRoutes = Router();

aiRoutes.get(
  '/status',
  authRequired,
  asyncRoute(async (req, res) => {
    res.json(aiStatus());
  })
);

aiRoutes.post(
  '/analyze',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ message: z.string().min(5) }).parse(req.body);
    const company = companyId(req);
    const categories = all<{ name: string }>(
      'SELECT name FROM occurrence_categories WHERE company_id = ? AND active = 1 ORDER BY name',
      company
    ).map((row) => row.name);
    const result = await callAIJson<Record<string, unknown>>(
      `Você extrai dados de reclamações de entregas. Responda apenas JSON com as chaves: isComplaint (boolean), category (string ou null), orderCode (string ou null), customerName (string ou null), description (string), suggestedPriority (Baixa|Normal|Alta|Urgente), missingFields (array de strings). Use apenas informações presentes na mensagem. Nunca invente dados. Categorias permitidas: ${categories.join(', ')}.`,
      body.message
    );
    res.json({ suggestion: result, requiresHumanConfirmation: true, categories });
  })
);

aiRoutes.post(
  '/summarize',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ occurrenceId: z.string().optional(), text: z.string().min(10).optional() }).parse(req.body);
    let content = body.text;
    if (body.occurrenceId) {
      const occurrence = one<{ customer_name: string; description: string; status: string }>(
        'SELECT customer_name, description, status FROM occurrences WHERE id = ? AND company_id = ?',
        body.occurrenceId,
        companyId(req)
      );
      if (!occurrence) {
        res.status(404).json({ error: 'Ocorrência não encontrada.' });
        return;
      }
      const history = all<{ action: string; details: string | null }>(
        'SELECT action, details FROM occurrence_history WHERE occurrence_id = ? ORDER BY created_at',
        body.occurrenceId
      );
      content = `Cliente: ${occurrence.customer_name}. Status: ${occurrence.status}. Problema: ${occurrence.description}. Histórico: ${history.map((item) => `${item.action}${item.details ? ` (${item.details})` : ''}`).join('; ')}`;
    }
    if (!content) {
      res.status(400).json({ error: 'Informe occurrenceId ou text.' });
      return;
    }
    const summary = await callAIText('Resuma em português do Brasil, de forma objetiva, em até 4 frases. Não invente dados.', content);
    res.json({ summary });
  })
);

aiRoutes.post(
  '/reply',
  authRequired,
  asyncRoute(async (req, res) => {
    const body = z.object({ message: z.string().min(5), customerName: z.string().optional() }).parse(req.body);
    const reply = await callAIText(
      'Você é um atendente de SAC de uma empresa de entregas. Sugira uma resposta profissional, empática e objetiva em português do Brasil. Não prometa prazos que não foram informados.',
      `Cliente: ${body.customerName || 'não informado'}. Mensagem: ${body.message}`
    );
    res.json({ reply });
  })
);
