import { getStore } from '@netlify/blobs';
import store from '../lib/store.js';
import impl from '../lib/handlers/webhook.js';
import v2 from '../lib/v2.js';

store.useGetStore(getStore);

export default v2.wrap(impl.handler);
