import handler from '../../netlify/lib/handlers/public-settings.js';
import { wrap } from '../_adapter.js';
export const onRequest = wrap(handler.handler);
