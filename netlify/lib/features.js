'use strict';

// Registro central de recursos do painel. Cada um pode ser ligado/desligado.
// status: 'ativo'  = já implementado, o toggle funciona de verdade.
//         'em_breve' = no roadmap, aparece na lista mas ainda não faz efeito.
// def: valor padrão quando nunca foi configurado.
const { getJSON, setJSON } = require('./store');

const FEATURES = [
  // ---------- Painel & métricas ----------
  { id: 'card_meta', cat: 'Painel & métricas', label: 'Card Meta do mês', desc: 'Progresso e projeção da meta mensal.', status: 'ativo', def: true },
  { id: 'card_roas', cat: 'Painel & métricas', label: 'Card Origens / ROAS', desc: 'Tabela de origens com ROAS por campanha.', status: 'ativo', def: true },
  { id: 'card_produtos', cat: 'Painel & métricas', label: 'Card Vendas por produto', desc: 'Faturamento por oferta.', status: 'ativo', def: true },
  { id: 'card_funil', cat: 'Painel & métricas', label: 'Card Funil de conversão', desc: 'Etapas do funil com taxas.', status: 'ativo', def: true },
  { id: 'card_heatmap', cat: 'Painel & métricas', label: 'Card Melhores horários', desc: 'Heatmap de vendas por dia × hora.', status: 'ativo', def: true },
  { id: 'card_abandonados', cat: 'Painel & métricas', label: 'Card PIX abandonados', desc: 'Lista de recuperação por WhatsApp.', status: 'ativo', def: true },
  { id: 'som_venda', cat: 'Painel & métricas', label: 'Alerta sonoro de venda', desc: 'Toca um som quando cai uma venda.', status: 'ativo', def: true },
  { id: 'export_csv', cat: 'Painel & métricas', label: 'Exportar CSV', desc: 'Botão de download dos pedidos.', status: 'ativo', def: true },
  { id: 'comparar_periodos', cat: 'Painel & métricas', label: 'Comparar dois períodos', desc: 'Período atual vs anterior lado a lado.', status: 'ativo', def: true },
  { id: 'relatorio_pdf', cat: 'Painel & métricas', label: 'Relatório em PDF', desc: 'Exportar o período em PDF.', status: 'ativo', def: true },
  { id: 'dashboard_custom', cat: 'Painel & métricas', label: 'Dashboard personalizável', desc: 'Arrastar e esconder cards.', status: 'em_breve', def: false },
  { id: 'modo_tv', cat: 'Painel & métricas', label: 'Modo TV / telão', desc: 'Tela cheia pra deixar num monitor.', status: 'ativo', def: true },
  { id: 'mapa_estado', cat: 'Painel & métricas', label: 'Mapa por estado', desc: 'Vendas por região (via DDD).', status: 'ativo', def: true },
  { id: 'coorte_retencao', cat: 'Painel & métricas', label: 'Coorte de retenção', desc: 'Quantos seguem ativos por mês de entrada.', status: 'ativo', def: true },
  { id: 'modo_coach', cat: 'Painel & métricas', label: 'Modo coach', desc: 'Sugere a próxima ação do dia.', status: 'ativo', def: true },

  // ---------- Publicações ----------
  { id: 'social_publisher', cat: 'Publicações', label: 'Postador multi-rede', desc: 'Publicar vídeo em Instagram, TikTok, YouTube, Facebook e X de uma vez (Kwai manual).', status: 'ativo', def: true },

  // ---------- Página ----------
  { id: 'page_editor', cat: 'Página', label: 'Editor da página de vendas', desc: 'Editar nome, @, bio, foto de perfil, capa e números da landing pelo painel.', status: 'ativo', def: true },

  // ---------- Telegram & acesso ----------
  { id: 'telegram_venda', cat: 'Telegram & acesso', label: 'Notificar venda no Telegram', desc: 'Mensagem a cada venda paga.', status: 'ativo', def: true },
  { id: 'telegram_resumo', cat: 'Telegram & acesso', label: 'Resumo diário no Telegram', desc: 'Resumo automático às 21h.', status: 'ativo', def: true },
  { id: 'acesso_telegram', cat: 'Telegram & acesso', label: 'Convite único + expiração', desc: 'Link único por cliente e remoção ao vencer.', status: 'em_breve', def: false },
  { id: 'aba_membros', cat: 'Telegram & acesso', label: 'Aba Membros', desc: 'Quem está ativo, entrou e expira.', status: 'ativo', def: true },
  { id: 'renovacao_mrr', cat: 'Telegram & acesso', label: 'Renovação e MRR', desc: '“Expira em X dias” + receita recorrente.', status: 'ativo', def: true },
  { id: 'niveis_vip', cat: 'Telegram & acesso', label: 'Níveis VIP / VIP+', desc: 'Grupos e preços por nível.', status: 'ativo', def: true },
  { id: 'reenviar_acesso', cat: 'Telegram & acesso', label: 'Reenviar acesso', desc: '2ª via do link/PIX num clique.', status: 'em_breve', def: false },

  // ---------- Vendas & checkout ----------
  { id: 'cartao_boleto', cat: 'Vendas & checkout', label: 'Cartão e boleto no checkout', desc: 'Métodos além do PIX (AssetPay já suporta).', status: 'em_breve', def: false },
  { id: 'assinatura_recorrente', cat: 'Vendas & checkout', label: 'Assinatura recorrente', desc: 'Cobrança automática no cartão.', status: 'em_breve', def: false },
  { id: 'trial', cat: 'Vendas & checkout', label: 'Trial de entrada (R$1)', desc: 'Degustação que vira recorrente.', status: 'em_breve', def: false },
  { id: 'order_bump', cat: 'Vendas & checkout', label: 'Order bump', desc: 'Adicional com checkbox no checkout.', status: 'ativo', def: true },
  { id: 'ab_preco', cat: 'Vendas & checkout', label: 'Teste A/B de preço', desc: 'Alterna preços e mede a conversão.', status: 'ativo', def: true },
  { id: 'regenerar_pix', cat: 'Vendas & checkout', label: 'Regenerar PIX expirado', desc: 'Novo QR sem refazer cadastro.', status: 'ativo', def: true },
  { id: 'multi_gateway', cat: 'Vendas & checkout', label: 'Multi-gateway com fallback', desc: 'Usa outro gateway se a AssetPay cair.', status: 'em_breve', def: false },
  { id: 'cupons', cat: 'Vendas & checkout', label: 'Cupons de desconto', desc: 'Códigos promocionais com rastreio.', status: 'ativo', def: true },
  { id: 'editar_precos', cat: 'Vendas & checkout', label: 'Editar preços pelo painel', desc: 'Sem precisar de deploy.', status: 'em_breve', def: false },
  { id: 'prova_social', cat: 'Vendas & checkout', label: 'Prova social real', desc: '“X compraram hoje” com dados reais.', status: 'ativo', def: true },
  { id: 'quiz', cat: 'Vendas & checkout', label: 'Quiz de qualificação', desc: 'Segmenta o lead na entrada da landing.', status: 'ativo', def: true },
  { id: 'verificacao_idade', cat: 'Vendas & checkout', label: 'Verificação de idade (18+)', desc: 'Barreira de idade na entrada.', status: 'ativo', def: true },

  // ---------- Tráfego & ROAS ----------
  { id: 'meta_capi', cat: 'Tráfego & ROAS', label: 'Meta Conversions API', desc: 'Evento de compra server-side pro Meta.', status: 'em_breve', def: false },
  { id: 'gasto_meta_auto', cat: 'Tráfego & ROAS', label: 'Puxar gasto do Meta', desc: 'ROAS 100% automático (sem digitar).', status: 'em_breve', def: false },
  { id: 'gasto_tiktok', cat: 'Tráfego & ROAS', label: 'Gasto TikTok/Kwai', desc: 'Integração de gasto de outras redes.', status: 'em_breve', def: false },
  { id: 'ranking_criativos', cat: 'Tráfego & ROAS', label: 'Ranking de criativos', desc: 'Alerta de ROAS baixo por campanha.', status: 'ativo', def: true },
  { id: 'utm_builder', cat: 'Tráfego & ROAS', label: 'Montador de link UTM', desc: 'Gera links de anúncio marcados.', status: 'ativo', def: true },
  { id: 'funil_por_origem', cat: 'Tráfego & ROAS', label: 'Funil por origem', desc: 'Da visita à venda, por utm_source.', status: 'ativo', def: true },
  { id: 'atribuicao_multi', cat: 'Tráfego & ROAS', label: 'Atribuição multi-toque', desc: 'Qual criativo iniciou vs fechou.', status: 'em_breve', def: false },

  // ---------- Recuperação & remarketing ----------
  { id: 'recuperacao_auto', cat: 'Recuperação & remarketing', label: 'Recuperação automática', desc: 'Sequência D+0/D+1/D+3 do abandono.', status: 'em_breve', def: false },
  { id: 'downsell_auto', cat: 'Recuperação & remarketing', label: 'Downsell automático', desc: 'Popup de saída com oferta menor na landing.', status: 'ativo', def: true },
  { id: 'winback', cat: 'Recuperação & remarketing', label: 'Win-back de cancelados', desc: 'Reconquistar quem expirou.', status: 'em_breve', def: false },
  { id: 'publico_meta', cat: 'Recuperação & remarketing', label: 'Público personalizado', desc: 'Exportar base pro Meta (lookalike).', status: 'ativo', def: true },
  { id: 'central_disparos', cat: 'Recuperação & remarketing', label: 'Central de disparos', desc: 'Broadcast segmentado pra base.', status: 'em_breve', def: false },

  // ---------- Comunidade & gamificação ----------
  { id: 'gamificacao_membros', cat: 'Comunidade & gamificação', label: 'Pontos e fidelidade', desc: 'Ranking por tempo de casa e compras.', status: 'ativo', def: true },
  { id: 'boas_vindas', cat: 'Comunidade & gamificação', label: 'Boas-vindas automáticas', desc: 'Onboarding do novo membro.', status: 'em_breve', def: false },
  { id: 'reativacao_inativo', cat: 'Comunidade & gamificação', label: 'Reativação de inativo', desc: 'Empurrão antes de cancelar.', status: 'em_breve', def: false },
  { id: 'depoimentos', cat: 'Comunidade & gamificação', label: 'Mural de depoimentos', desc: 'Coleta e exibe prova social.', status: 'ativo', def: true },
  { id: 'embaixadores', cat: 'Comunidade & gamificação', label: 'Programa de indicação', desc: 'Member-get-member com recompensa.', status: 'ativo', def: true },
  { id: 'afiliados', cat: 'Comunidade & gamificação', label: 'Programa de afiliados', desc: 'Links ?ref, comissão e painel.', status: 'ativo', def: true },

  // ---------- IA ----------
  { id: 'ia_assistente', cat: 'Inteligência artificial', label: 'Assistente “por que caiu?”', desc: 'Pergunte e a IA analisa seus dados.', status: 'em_breve', def: false },
  { id: 'ia_resumo', cat: 'Inteligência artificial', label: 'Resumo em linguagem natural', desc: 'Um parágrafo explicando o período.', status: 'ativo', def: true },
  { id: 'ia_sdr', cat: 'Inteligência artificial', label: 'SDR virtual (bot de vendas)', desc: 'IA fecha no WhatsApp/Telegram.', status: 'em_breve', def: false },
  { id: 'ia_forecast', cat: 'Inteligência artificial', label: 'Previsão de faturamento', desc: 'Projeção do mês + detecção de anomalia.', status: 'ativo', def: true },

  // ---------- Financeiro ----------
  { id: 'dre', cat: 'Financeiro', label: 'DRE / lucro real', desc: 'Receita − taxas − tráfego − imposto.', status: 'ativo', def: true },
  { id: 'saldo_assetpay', cat: 'Financeiro', label: 'Saldo AssetPay ao vivo', desc: 'A receber, disponível e reserva.', status: 'em_breve', def: false },
  { id: 'recebiveis', cat: 'Financeiro', label: 'Previsão de recebíveis', desc: 'Quando cada venda libera.', status: 'ativo', def: true },
  { id: 'nota_fiscal', cat: 'Financeiro', label: 'Nota fiscal automática', desc: 'Emissão a cada venda.', status: 'em_breve', def: false },
  { id: 'imposto', cat: 'Financeiro', label: 'Estimativa de imposto', desc: 'DAS/Simples sobre o faturamento.', status: 'ativo', def: true },

  // ---------- Integrações ----------
  { id: 'planilha_google', cat: 'Integrações', label: 'Planilha Google', desc: 'Cada venda vira uma linha.', status: 'em_breve', def: false },
  { id: 'webhooks', cat: 'Integrações', label: 'Webhooks de saída', desc: 'Plugar em Zapier/n8n/Discord.', status: 'ativo', def: true },
  { id: 'backup', cat: 'Integrações', label: 'Backup / exportação total', desc: 'Baixar todos os dados.', status: 'ativo', def: true },
  { id: 'notif_email_sms', cat: 'Integrações', label: 'Notificação e-mail/SMS', desc: 'Alertas além do Telegram.', status: 'em_breve', def: false },

  // ---------- Segurança ----------
  { id: 'mascarar_pii', cat: 'Segurança', label: 'Mascarar CPF/e-mail/telefone', desc: 'Esconde dados sensíveis no painel.', status: 'ativo', def: true },
  { id: 'push_pwa', cat: 'Segurança', label: 'Push no celular (PWA)', desc: 'Alerta de venda com o painel fechado.', status: 'em_breve', def: false },
  { id: '2fa', cat: 'Segurança', label: '2FA no login', desc: 'Segundo fator de autenticação.', status: 'em_breve', def: false },
  { id: 'auto_logout', cat: 'Segurança', label: 'Auto-logout por inatividade', desc: 'Encerra a sessão parada (30 min).', status: 'ativo', def: false },
  { id: 'multiusuario', cat: 'Segurança', label: 'Multiusuário com papéis', desc: 'Admin e leitura, com log de acesso.', status: 'em_breve', def: false },
  { id: 'antifraude', cat: 'Segurança', label: 'Detecção de fraude', desc: 'Alerta de telefone/e-mail repetido.', status: 'ativo', def: true },
];

const DEFAULTS = {};
FEATURES.forEach((f) => { DEFAULTS[f.id] = f.def; });

async function getFlags() {
  const saved = (await getJSON('config/features.json')) || {};
  const out = {};
  FEATURES.forEach((f) => { out[f.id] = (f.id in saved) ? !!saved[f.id] : f.def; });
  return out;
}

// Só recursos 'ativo' podem ser alterados (os 'em_breve' ainda não fazem efeito).
async function setFlag(id, on) {
  const feat = FEATURES.find((f) => f.id === id);
  if (!feat || feat.status !== 'ativo') return false;
  const saved = (await getJSON('config/features.json')) || {};
  saved[id] = !!on;
  await setJSON('config/features.json', saved);
  return true;
}

async function isEnabled(id) {
  const flags = await getFlags();
  return !!flags[id];
}

module.exports = { FEATURES, DEFAULTS, getFlags, setFlag, isEnabled };
