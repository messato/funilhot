const params = new URLSearchParams(window.location.search);
const plan = params.get('plan') || 'mensal';
const offerType = params.get('offer') === 'downsell' ? 'downsell' : 'upsell';

// Lead completo (com CPF/telefone) vem do sessionStorage gravado no checkout;
// nome/e-mail da URL são só fallback de exibição.
let stored = {};
try { stored = JSON.parse(sessionStorage.getItem('funil_lead') || '{}'); } catch { stored = {}; }

const lead = {
  nome: stored.nome || params.get('nome') || 'Lead',
  email: stored.email || params.get('email') || 'não informado',
  telefone: stored.telefone || '',
  cpf: stored.cpf || '',
};

// Apenas exibição. O preço real é definido pelo servidor.
const DISPLAY = {
  upsell: {
    mensal: { title: 'Upgrade Mensal', price: 'R$ 49,90', description: 'Mais 60 dias de acesso com o upgrade mensal.' },
    trimestral: { title: 'Upgrade Trimestral', price: 'R$ 149,90', description: 'Mais 60 dias de acesso com o upgrade trimestral.' },
  },
  downsell: {
    mensal: { title: 'Oferta Final Mensal', price: 'R$ 39,90', description: 'Oferta especial para manter o acesso com mais 60 dias.' },
    trimestral: { title: 'Oferta Final Trimestral', price: 'R$ 119,90', description: 'Última chance para manter o acesso com valor especial.' },
  },
};

const display = (DISPLAY[offerType] && DISPLAY[offerType][plan]) || DISPLAY.upsell.mensal;

const el = (id) => document.getElementById(id);
const titulo = el('titulo');
const valor = el('valor');
const descricao = el('descricao');
const leadNome = el('lead-nome');
const leadEmail = el('lead-email');
const pixCodeEl = el('pix-code');
const copyBtn = el('copy-pix');
const confirmBtn = el('confirmar-pagamento');
const statusBox = el('status-box');

titulo.textContent = display.title;
valor.textContent = display.price;
descricao.textContent = display.description;
leadNome.textContent = `Nome: ${lead.nome}`;
leadEmail.textContent = `E-mail: ${lead.email}`;
pixCodeEl.textContent = 'Gerando código PIX...';

let currentBrcode = '';
let currentId = '';
let pollTimer = null;

copyBtn.addEventListener('click', async () => {
  if (!currentBrcode) return;
  try {
    await navigator.clipboard.writeText(currentBrcode);
    statusBox.className = 'status-box sucesso';
    statusBox.textContent = 'Código PIX copiado! Cole no app do seu banco.';
  } catch {
    statusBox.className = 'status-box erro';
    statusBox.textContent = 'Não foi possível copiar automaticamente.';
  }
});

function showQr(qrImage) {
  const ph = document.getElementById('qr-placeholder');
  if (!qrImage || !ph) return;
  const img = document.createElement('img');
  img.src = qrImage;
  img.alt = 'QR Code PIX';
  img.style.cssText = 'width:180px;height:180px;object-fit:contain;border-radius:16px;background:#fff;';
  ph.replaceWith(img);
}

function goToThankYou() {
  const nextUrl = new URL('obrigado.html', window.location.href);
  nextUrl.searchParams.set('nome', lead.nome);
  nextUrl.searchParams.set('email', lead.email);
  nextUrl.searchParams.set('plan', plan);
  nextUrl.searchParams.set('id', currentId);
  window.location.href = nextUrl.toString();
}

async function checkStatus(manual) {
  if (!currentId) return;
  try {
    const res = await fetch(`/api/status?id=${encodeURIComponent(currentId)}`);
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.paid) {
      if (pollTimer) clearInterval(pollTimer);
      statusBox.className = 'status-box sucesso';
      statusBox.textContent = 'Pagamento confirmado! Redirecionando...';
      setTimeout(goToThankYou, 800);
    } else if (manual) {
      statusBox.className = 'status-box erro';
      statusBox.textContent = 'Ainda não identificamos o pagamento. Se já pagou, aguarde alguns segundos.';
    }
  } catch {
    if (manual) {
      statusBox.className = 'status-box erro';
      statusBox.textContent = 'Não foi possível verificar agora. Tente de novo em instantes.';
    }
  }
}

confirmBtn.addEventListener('click', () => checkStatus(true));

async function generateCharge() {
  if (!lead.cpf) {
    pixCodeEl.textContent = 'Dados do pedido não encontrados.';
    statusBox.className = 'status-box erro';
    statusBox.textContent = 'Não encontramos seus dados. Volte ao checkout e preencha novamente.';
    return;
  }
  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: offerType, plan, nome: lead.nome, email: lead.email, telefone: lead.telefone, cpf: lead.cpf }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error('Não foi possível gerar o PIX agora.');
    }

    const d = result.data;
    currentBrcode = d.brcode || '';
    currentId = d.id;
    valor.textContent = d.price || display.price;
    pixCodeEl.textContent = currentBrcode || 'Código indisponível';
    showQr(d.qrImage);

    statusBox.className = 'status-box sucesso';
    statusBox.textContent = 'PIX gerado! Pague no app do banco — a confirmação é automática.';

    if (d.status === 'paid') {
      setTimeout(goToThankYou, 500);
    } else {
      pollTimer = setInterval(() => checkStatus(false), 4000);
    }
  } catch (error) {
    pixCodeEl.textContent = 'Erro ao gerar PIX';
    statusBox.className = 'status-box erro';
    statusBox.textContent = error.message || 'Não foi possível gerar o PIX no momento.';
  }
}

generateCharge();
