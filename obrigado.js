const params = new URLSearchParams(window.location.search);
const chargeId = params.get('id') || '';

const statusEl = document.getElementById('status-texto');
const tituloEl = document.querySelector('.titulo');
const acessarBtn = document.querySelector('.btn-acessar');
const comoAcessar = document.querySelector('.como-acessar');

function hideAccess() {
  if (acessarBtn) acessarBtn.style.display = 'none';
  if (comoAcessar) comoAcessar.style.display = 'none';
}

function revealAccess() {
  if (acessarBtn) acessarBtn.style.display = 'block';
  if (comoAcessar) comoAcessar.style.display = 'block';
  if (tituloEl) tituloEl.textContent = 'Pagamento Confirmado!';
  statusEl.textContent = '✅ Pagamento confirmado! Seu acesso está liberado.';
}

// Link do grupo VIP e suporte vêm das configurações editáveis do painel.
fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) {
  if (!j.ok || !j.settings) return;
  if (acessarBtn && j.settings.vipLink) acessarBtn.setAttribute('href', j.settings.vipLink);
  var sup = document.querySelector('.suporte a');
  if (sup && j.settings.supportLink) sup.setAttribute('href', j.settings.supportLink);
}).catch(function () { /* mantém os links padrão do HTML */ });

// O acesso só aparece depois que o gateway confirmar o pagamento.
hideAccess();
if (tituloEl) tituloEl.textContent = 'Confirmando pagamento...';

let dots = 0;
const anim = setInterval(() => {
  dots = (dots + 1) % 4;
  statusEl.textContent = '⏳ Confirmando seu pagamento' + '.'.repeat(dots);
}, 500);

async function verify() {
  try {
    const res = await fetch(`/api/status?id=${encodeURIComponent(chargeId)}`);
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.paid) {
      clearInterval(anim);
      clearInterval(poll);
      revealAccess();
    }
  } catch {
    // tenta de novo no próximo ciclo
  }
}

let poll;
if (!chargeId) {
  clearInterval(anim);
  statusEl.textContent = 'Não recebemos a confirmação do seu pagamento. Se você já pagou, fale com o suporte.';
} else {
  const startedAt = Date.now();
  verify();
  poll = setInterval(() => {
    if (Date.now() - startedAt > 10 * 60 * 1000) {
      clearInterval(poll);
      clearInterval(anim);
      statusEl.textContent = 'Ainda não identificamos o pagamento. Se já pagou, aguarde alguns minutos ou fale com o suporte.';
      return;
    }
    verify();
  }, 4000);
}
