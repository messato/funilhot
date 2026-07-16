import handler from '../../netlify/lib/handlers/webhook.js';
import { wrap } from '../_adapter.js';
export const onRequest = wrap(handler.handler);
