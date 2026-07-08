const params = new URLSearchParams(window.location.search);

const planConfig = {
  mensal: {
    title: 'Plano Mensal',
    price: 'R$ 39,90',
    duration: '30 dias de acesso',
    pixCode: 'PIX-MENSAL-001'
  },
  trimestral: {
    title: 'Plano Trimestral',
    price: 'R$ 97,90',
    duration: '90 dias de acesso',
    pixCode: 'PIX-TRIMESTRAL-001'
  },
  anual: {
    title: 'Plano Anual',
    price: 'R$ 297,00',
    duration: '1 ano de acesso',
    pixCode: 'PIX-ANUAL-001'
  },
  default: {
    title: 'Plano selecionado',
    price: 'R$ 0,00',
    duration: 'Acesso imediato após confirmação',
    pixCode: 'PIX-AGATHA-0001'
  }
};

const selectedPlan = params.get('plan') || 'default';
const config = planConfig[selectedPlan] || planConfig.default;

const checkoutTitle = document.getElementById('checkout-title');
const checkoutSubtitle = document.getElementById('checkout-subtitle');
const checkoutPlan = document.getElementById('checkout-plan');
const checkoutPrice = document.getElementById('checkout-price');
const checkoutDuration = document.getElementById('checkout-duration');
const pixCode = document.getElementById('pix-code');
const pixStatus = document.getElementById('pix-status');
const copyPixButton = document.getElementById('copy-pix');
const form = document.getElementById('checkout-form');
const formStatus = document.getElementById('form-status');

checkoutTitle.textContent = `Finalize seu ${config.title.toLowerCase()}`;
checkoutSubtitle.textContent = 'Preencha os seus dados e finalize o pagamento por PIX.';
checkoutPlan.textContent = config.title;
checkoutPrice.textContent = config.price;
checkoutDuration.textContent = config.duration;
pixCode.textContent = config.pixCode;
pixStatus.textContent = `Código PIX preparado para ${config.title}.`;

copyPixButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(config.pixCode);
    pixStatus.textContent = 'Código PIX copiado com sucesso!';
  } catch (error) {
    pixStatus.textContent = 'Não foi possível copiar automaticamente. Copie manualmente.';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    nome: formData.get('nome'),
    email: formData.get('email'),
    telefone: formData.get('telefone'),
    plano: config.title,
    valor: config.price,
    metodo: 'pix',
    status: 'pendente',
    createdAt: new Date().toISOString()
  };

  formStatus.className = 'status-box sucesso';
  formStatus.textContent = 'Pedido recebido. Redirecionando para a próxima etapa...';

  console.info('Payload pronto para API:', payload);

  const redirectMap = {
    mensal: 'upsell-mensal.html',
    trimestral: 'upsell-trimestral.html',
    anual: 'obrigado.html'
  };

  const redirectTarget = redirectMap[selectedPlan] || 'obrigado.html';

  const query = new URLSearchParams({
    plan: selectedPlan,
    nome: payload.nome,
    email: payload.email
  }).toString();

  setTimeout(() => {
    window.location.href = `${redirectTarget}?${query}`;
  }, 900);
});
