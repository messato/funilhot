import handler from '../../../../netlify/lib/handlers/social.js';
import { wrap } from '../../../_adapter.js';
export const onRequest = wrap(handler.handler);
