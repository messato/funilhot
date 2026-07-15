import impl from '../lib/handlers/webhook.js';
import v2 from '../lib/v2.js';

export default v2.wrap(impl.handler);
