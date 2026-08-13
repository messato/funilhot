import handler from '../../../../netlify/lib/handlers/bot-admin.js';
import { wrap } from '../../../_adapter.js';
export const onRequest = wrap(handler.handler);
