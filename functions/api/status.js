import handler from '../../netlify/lib/handlers/status.js';
import { wrap } from '../_adapter.js';
export const onRequest = wrap(handler.handler);
