// Webhook do bot: /api/tg/<caminho-secreto>
// O caminho secreto é a primeira barreira — um scanner recebe 404 antes de
// qualquer leitura de KV. O header secreto (validado no handler) é a segunda.
import handler from '../../../netlify/lib/handlers/tgbot.js';
import { wrap } from '../../_adapter.js';

export const onRequest = async (context) => {
  const esperado = context.env.TELEGRAM_WEBHOOK_PATH || '';
  if (!esperado || context.params.secret !== esperado) {
    return new Response('Not found', { status: 404 });
  }
  return wrap(handler.handler)(context);
};
