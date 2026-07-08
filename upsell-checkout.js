const params = new URLSearchParams(window.location.search);
const plan = params.get('plan') || 'mensal';
const offerType = params.get('offer') || 'upsell';

const lead = {
  nome: params.get('nome') || 'Lead',
  email: params.get('email') || 'não informado'
};

const config = {
  mensal: {
    title: offerType === 'downsell' ? 'Oferta Final Mensal' : 'Upgrade Mensal',
    value: offerType === 'downsell' ? 'R$ 39,90' : 'R$ 49,90',
    description: offerType === 'downsell'
      ? 'Oferta especial para manter o acesso com mais 60 dias.'
      : 'Mais 60 dias de acesso com o upgrade mensal.',
    pixCode: offerType === 'downsell' ? 'PIX-DOWNSILL-MENSAL-03990' : 'PIX-UPSELL-MENSAL-04990'
  },
  trimestral: {
    title: offerType === 'downsell' ? 'Oferta Final Trimestral' : 'Upgrade Trimestral',
    value: offerType === 'downsell' ? 'R$ 119,90' : 'R$ 149,90',
    description: offerType === 'downsell'
      ? 'Última chance para manter o acesso com valor especial.'
      : 'Mais 60 dias de acesso com o upgrade trimestral.',
    pixCode: offerType === 'downsell' ? 'PIX-DOWNSILL-TRIMESTRAL-11990' : 'PIX-UPSELL-TRIMESTRAL-14990'
  }
};

const selected = config[plan] || config.mensal;

const titulo = document.getElementById('titulo');
const valor = document.getElementById('valor');
const descricao = document.getElementById('descricao');
const leadNome = document.getElementById('lead-nome');
const leadEmail = document.getElementById('lead-email');
const pixCode = document.getElementById('pix-code');
const copyBtn = document.getElementById('copy-pix');
const confirmBtn = document.getElementById('confirmar-pagamento');
const statusBox = document.getElementById('status-box');

titulo.textContent = selected.title;
valor.textContent = selected.value;
descricao.textContent = selected.description;
leadNome.textContent = `Nome: ${lead.nome}`;
leadEmail.textContent = `E-mail: ${lead.email}`;
pixCode.textContent = selected.pixCode;

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(selected.pixCode);
    statusBox.className = 'status-box sucesso';
    statusBox.textContent = 'Código PIX copiado com sucesso.';
  } catch (error) {
    statusBox.className = 'status-box erro';
    statusBox.textContent = 'Não foi possível copiar automaticamente.';
  }
});

confirmBtn.addEventListener('click', () => {
  statusBox.className = 'status-box sucesso';
  statusBox.textContent = 'Pagamento recebido. Redirecionando para a confirmação...';

  setTimeout(() => {
    const nextUrl = new URL('obrigado.html', window.location.href);
    nextUrl.searchParams.set('nome', lead.nome);
    nextUrl.searchParams.set('email', lead.email);
    nextUrl.searchParams.set('plan', plan);
    window.location.href = nextUrl.toString();
  }, 900);
});
