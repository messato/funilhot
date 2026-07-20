const params = new URLSearchParams(window.location.search);

// Apenas para exibição inicial (cosmético). O preço real vem do servidor.
const DISPLAY = {
  mensal: { title: 'Plano Mensal', price: 'R$ 39,90', duration: '30 dias de acesso' },
  trimestral: { title: 'Plano Trimestral', price: 'R$ 97,90', duration: '90 dias de acesso' },
  anual: { title: 'Plano Anual', price: 'R$ 297,00', duration: '1 ano de acesso' },
};

const selectedPlan = params.get('plan') || 'mensal';
const display = DISPLAY[selectedPlan] || DISPLAY.mensal;

const el = (id) => document.getElementById(id);
const checkoutTitle = el('checkout-title');
const checkoutSubtitle = el('checkout-subtitle');
const checkoutPlan = el('checkout-plan');
const checkoutPrice = el('checkout-price');
const checkoutDuration = el('checkout-duration');
const pixCodeEl = el('pix-code');
const pixStatus = el('pix-status');
const copyPixButton = el('copy-pix');
const form = el('checkout-form');
const formStatus = el('form-status');
const submitButton = el('submit-btn');

checkoutTitle.textContent = `Finalize seu ${display.title.toLowerCase()}`;
checkoutSubtitle.textContent = 'Preencha seus dados e gere o PIX para pagar.';
checkoutPlan.textContent = display.title;
checkoutPrice.textContent = display.price;
checkoutDuration.textContent = display.duration;

// Preço/order-bump vindos do painel. O valor cobrado é sempre resolvido no servidor.
let basePriceCents = 0;
let bumpCfg = null;
const fmtBRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function refreshTotal() {
  let total = basePriceCents;
  if (bumpCfg && bumpCfg.enabled && el('bump-check') && el('bump-check').checked) total += bumpCfg.price;
  if (total) checkoutPrice.textContent = fmtBRL(total);
}
fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) {
  if (!j.ok || !j.settings) return;
  var cents = j.settings.prices && j.settings.prices['checkout/' + selectedPlan];
  if (cents) basePriceCents = cents;
  bumpCfg = j.settings.orderBump || null;
  if (bumpCfg && bumpCfg.enabled) {
    el('bump-label').textContent = bumpCfg.label || 'Adicional';
    el('bump-price').textContent = '+ ' + fmtBRL(bumpCfg.price);
    el('bump-desc').textContent = bumpCfg.desc || '';
    el('bump-box').style.display = 'flex';
    el('bump-check').addEventListener('change', refreshTotal);
  }
  refreshTotal();
}).catch(function () {});
pixCodeEl.textContent = 'O código PIX será gerado ao finalizar.';

let currentBrcode = '';
let currentId = '';
let currentLead = { nome: '', email: '' };
let pollTimer = null;

// UTMs capturadas pelo funnel-track.js — atribuem a venda à origem do tráfego.
function getUtm() {
  try {
    const u = JSON.parse(localStorage.getItem('funil_utm') || '{}');
    return { us: u.utm_source || '', um: u.utm_medium || '', uc: u.utm_campaign || '', ref: localStorage.getItem('funil_ref') || '' };
  } catch {
    return {};
  }
}

copyPixButton.addEventListener('click', async () => {
  if (!currentBrcode) {
    pixStatus.textContent = 'Gere o PIX primeiro em "Finalizar pagamento".';
    return;
  }
  try {
    await navigator.clipboard.writeText(currentBrcode);
    pixStatus.textContent = 'Código PIX copiado! Cole no app do seu banco.';
  } catch {
    pixStatus.textContent = 'Não foi possível copiar automaticamente. Copie manualmente.';
  }
});

function showQr(qrImage) {
  if (!qrImage) return;
  let img = document.getElementById('pix-qr');
  if (!img) {
    img = document.createElement('img');
    img.id = 'pix-qr';
    img.alt = 'QR Code PIX';
    img.style.cssText = 'display:block;max-width:200px;width:100%;margin:0 auto 12px;border-radius:12px;background:#fff;';
    pixCodeEl.parentNode.insertBefore(img, pixCodeEl);
  }
  img.src = qrImage;
}

function redirectPaid() {
  const redirectMap = {
    mensal: 'upsell-mensal.html',
    trimestral: 'upsell-trimestral.html',
    anual: 'obrigado.html',
  };
  const target = redirectMap[selectedPlan] || 'obrigado.html';
  const query = new URLSearchParams({
    plan: selectedPlan,
    nome: currentLead.nome,
    email: currentLead.email,
    id: currentId,
  });
  window.location.href = `${target}?${query.toString()}`;
}

function startPolling() {
  const startedAt = Date.now();
  pollTimer = setInterval(async () => {
    if (Date.now() - startedAt > 15 * 60 * 1000) {
      clearInterval(pollTimer);
      pixStatus.textContent = 'PIX expirado. Recarregue a página para gerar outro.';
      return;
    }
    try {
      const res = await fetch(`/api/status?id=${encodeURIComponent(currentId)}`);
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.paid) {
        clearInterval(pollTimer);
        formStatus.className = 'status-box sucesso';
        formStatus.textContent = 'Pagamento confirmado! Redirecionando...';
        setTimeout(redirectPaid, 800);
      }
    } catch {
      // rede instável — tenta de novo no próximo ciclo
    }
  }, 4000);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const nome = (formData.get('nome') || '').toString().trim();
  const email = (formData.get('email') || '').toString().trim();
  const telefone = (formData.get('telefone') || '').toString().replace(/\D/g, '');
  const cpf = (formData.get('cpf') || '').toString().replace(/\D/g, '');

  if (nome.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    formStatus.className = 'status-box erro';
    formStatus.textContent = 'Informe um nome e um e-mail válidos.';
    return;
  }
  if (telefone.length < 10) {
    formStatus.className = 'status-box erro';
    formStatus.textContent = 'Informe um telefone válido com DDD.';
    return;
  }
  if (cpf.length !== 11) {
    formStatus.className = 'status-box erro';
    formStatus.textContent = 'Informe um CPF válido (11 dígitos).';
    return;
  }

  // Guarda o lead para as próximas etapas do funil (upsell/downsell)
  // sem expor CPF/telefone na URL.
  try {
    sessionStorage.setItem('funil_lead', JSON.stringify({ nome, email, telefone, cpf }));
  } catch { /* sessão indisponível não impede o checkout */ }

  submitButton.disabled = true;
  formStatus.className = 'status-box sucesso';
  formStatus.textContent = 'Gerando seu PIX...';

  try {
    const cupom = (el('cupom') && el('cupom').value.trim()) || '';
    const orderBump = !!(el('bump-check') && el('bump-check').checked);
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: 'checkout', plan: selectedPlan, nome, email, telefone, cpf, coupon: cupom, orderBump, ...getUtm() }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (result && result.error === 'invalid_coupon') {
        if (el('cupom-status')) { el('cupom-status').style.color = '#ff6b6b'; el('cupom-status').textContent = 'Cupom inválido ou esgotado.'; }
        throw new Error('Cupom inválido. Confira o código ou remova para continuar.');
      }
      throw new Error('Não foi possível gerar o PIX agora. Tente novamente.');
    }
    if (result.data && result.data.couponApplied && el('cupom-status')) {
      el('cupom-status').style.color = '#34e5b0';
      el('cupom-status').textContent = 'Cupom aplicado: −' + fmtBRL(result.data.discount || 0);
    }

    const d = result.data;
    currentBrcode = d.brcode || '';
    currentId = d.id;
    currentLead = { nome, email };

    checkoutPrice.textContent = d.price || display.price;
    pixCodeEl.textContent = currentBrcode || 'Código indisponível';
    showQr(d.qrImage);

    pixStatus.textContent = 'Copie o código e pague no app do seu banco.';
    formStatus.textContent = 'PIX gerado! Assim que o pagamento cair, você será redirecionado automaticamente.';
    submitButton.textContent = 'Aguardando pagamento...';

    if (d.status === 'paid') {
      setTimeout(redirectPaid, 500);
    } else {
      startPolling();
    }
  } catch (error) {
    submitButton.disabled = false;
    formStatus.className = 'status-box erro';
    formStatus.textContent = error.message || 'Não foi possível processar o pedido no momento.';
  }
});
