// Serve as imagens da landing guardadas no KV (público, same-origin → CSP 'self').
export async function onRequest(context) {
  const name = String(context.params.name || '').replace(/[^a-z]/gi, '');
  if (!name) return new Response('not found', { status: 404 });

  const r = await context.env.funil.getWithMetadata('media/' + name, { type: 'arrayBuffer' });
  if (!r || !r.value) return new Response('not found', { status: 404 });

  const ct = (r.metadata && r.metadata.ct) || 'image/jpeg';
  return new Response(r.value, {
    headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=300' },
  });
}
