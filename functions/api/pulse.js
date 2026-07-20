import handler from '../../netlify/lib/handlers/pulse.js';
import { wrap } from '../_adapter.js';
export const onRequest = wrap(handler.handler);
