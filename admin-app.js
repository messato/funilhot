/* Painel /admin — consome /api/admin/* e desenha tudo sem dependências externas. */
(function () {
  'use strict';

  var state = { days: 7, metric: 'revenue', data: null, timer: null };

  var $ = function (id) { return document.getElementById(id); };
  var brl = function (cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function key() { return sessionStorage.getItem('admin_key') || ''; }

  function api(path) {
    return fetch('/api/admin/' + path, { headers: { 'x-admin-key': key() } }).then(function (r) {
      if (r.status === 401) { logout(); throw new Error('unauthorized'); }
      return r;
    });
  }

  function logout() {
    sessionStorage.removeItem('admin_key');
    if (state.timer) clearInterval(state.timer);
    $('app').style.display = 'none';
    $('login').style.display = 'block';
  }

  // ---------- Login ----------
  function tryLogin() {
    var pass = $('senha').value.trim();
    if (!pass) return;
    fetch('/api/admin/ping', { headers: { 'x-admin-key': pass } }).then(function (r) {
      if (r.ok) {
        sessionStorage.setItem('admin_key', pass);
        boot();
      } else {
        $('login-erro').style.display = 'block';
      }
    });
  }
  $('entrar').addEventListener('click', tryLogin);
  $('senha').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
  $('sair').addEventListener('click', logout);

  // ---------- KPIs ----------
  function delta(curr, prev, invert) {
    if (!prev) return '<span class="delta flat">—</span>';
    var pct = Math.round(((curr - prev) / prev) * 100);
    var cls = pct === 0 ? 'flat' : (pct > 0 !== Boolean(invert) ? 'up' : 'down');
    var arrow = pct === 0 ? '•' : (pct > 0 ? '▲' : '▼');
    return '<span class="delta ' + cls + '">' + arrow + ' ' + Math.abs(pct) + '% vs período anterior</span>';
  }

  function renderKpis(d) {
    var k = d.kpis, p = d.prevKpis;
    $('kpis').innerHTML = [
      { label: 'Faturamento (bruto)', value: brl(k.gross), d: delta(k.gross, p.gross) },
      { label: 'Líquido (pós-taxas)', value: brl(k.net), d: delta(k.net, p.net) },
      { label: 'Vendas pagas', value: k.paidCount, d: delta(k.paidCount, p.paidCount) },
      { label: 'Ticket médio', value: brl(k.ticket), d: delta(k.ticket, p.ticket) },
      { label: 'PIX gerados', value: k.pixCount, d: delta(k.pixCount, p.pixCount) },
      { label: 'Conversão do PIX', value: k.pixConversion + '%', d: delta(k.pixConversion, p.pixConversion) },
      { label: 'Visitas na página', value: k.visits, d: delta(k.visits, p.visits) },
      { label: 'Visitantes únicos', value: k.uniques, d: delta(k.uniques, p.uniques) },
    ].map(function (t) {
      return '<div class="kpi"><div class="label">' + t.label + '</div>' +
        '<div class="value">' + t.value + '</div>' + t.d + '</div>';
    }).join('');
  }

  // ---------- Gráfico de colunas (SVG) ----------
  var METRIC_LABEL = { revenue: 'Receita', pago: 'Vendas', pix: 'PIX gerados', visits: 'Visitas' };

  function renderChart(d) {
    var rows = d.daily;
    var isMoney = state.metric === 'revenue';
    var vals = rows.map(function (r) { return r[state.metric] || 0; });
    var max = Math.max.apply(null, vals.concat([1]));

    var W = Math.max(560, rows.length * 34), H = 220;
    var padL = 46, padB = 26, padT = 14;
    var plotW = W - padL - 10, plotH = H - padT - padB;
    var bw = Math.min(22, (plotW / rows.length) - 2);

    var css = getComputedStyle(document.documentElement);
    var accent = css.getPropertyValue('--accent').trim();
    var grid = css.getPropertyValue('--grid').trim();
    var muted = css.getPropertyValue('--muted').trim();

    var fmt = function (v) {
      if (!isMoney) return String(v);
      return v >= 100000 ? 'R$' + Math.round(v / 100000) / 10 + 'k' : 'R$' + Math.round(v / 100);
    };

    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + METRIC_LABEL[state.metric] + ' por dia">';
    for (var g = 0; g <= 3; g++) {
      var gy = padT + plotH - (plotH * g / 3);
      svg += '<line x1="' + padL + '" y1="' + gy + '" x2="' + W + '" y2="' + gy + '" stroke="' + grid + '" stroke-width="1"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10" fill="' + muted + '">' + fmt(max * g / 3) + '</text>';
    }
    rows.forEach(function (r, i) {
      var v = r[state.metric] || 0;
      var h = Math.round(plotH * v / max);
      var x = padL + (plotW / rows.length) * i + ((plotW / rows.length) - bw) / 2;
      var y = padT + plotH - h;
      var title = r.day.slice(8) + '/' + r.day.slice(5, 7) + ': ' + (isMoney ? brl(v) : v);
      svg += '<g><rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, 1) + '" rx="4" fill="' + accent + '">' +
        '<title>' + title + '</title></rect>';
      if (rows.length <= 32 && (rows.length <= 14 || i % Math.ceil(rows.length / 14) === 0)) {
        svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="' + muted + '">' + r.day.slice(8) + '/' + r.day.slice(5, 7) + '</text>';
      }
      svg += '</g>';
    });
    svg += '</svg>';
    $('chart').innerHTML = svg;
    $('chart-hint').textContent = '— ' + METRIC_LABEL[state.metric] + ' por dia';
  }

  // ---------- Funil ----------
  function renderFunnel(d) {
    var max = Math.max.apply(null, d.funnel.map(function (f) { return f.count; }).concat([1]));
    $('funnel').innerHTML = d.funnel.map(function (f, i) {
      var w = Math.round((f.count / max) * 100);
      return '<div class="funnel-row">' +
        '<div class="funnel-label">' + esc(f.step) + '</div>' +
        '<div class="funnel-track"><div class="funnel-bar" style="width:' + w + '%"></div></div>' +
        '<div class="funnel-num">' + f.count + (i > 0 ? ' <span class="pct">(' + f.rate + '%)</span>' : '') + '</div>' +
        '</div>';
    }).join('');
  }

  // ---------- Tabelas ----------
  function table(headers, rows, empty) {
    if (!rows.length) return '<div class="empty">' + empty + '</div>';
    return '<table><thead><tr>' + headers.map(function (h) {
      return '<th class="' + (h.num ? 'num' : '') + '">' + h.t + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) {
        return '<td class="' + (headers[i].num ? 'num' : '') + '">' + c + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  function renderProducts(d) {
    $('products').innerHTML = table(
      [{ t: 'Produto' }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }],
      d.products.map(function (p) { return [esc(p.label), p.paid, brl(p.revenue)]; }),
      'Nenhuma venda no período ainda.'
    );
  }

  function renderUtm(d) {
    $('utm').innerHTML = table(
      [{ t: 'Origem' }, { t: 'Campanha' }, { t: 'Visitas', num: 1 }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }],
      d.utm.map(function (u) {
        return [esc(u.source), esc(u.campaign || '—'), u.views, u.pago, brl(u.revenue)];
      }),
      'Sem tráfego registrado ainda — os dados aparecem conforme as visitas chegam.'
    );
  }

  var fmtDataHora = function (ts) {
    return ts ? new Date(ts).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }) : '—';
  };

  function renderOrders() {
    api('orders?days=' + state.days).then(function (r) { return r.json(); }).then(function (j) {
      $('orders').innerHTML = table(
        [{ t: 'Quando' }, { t: 'Cliente' }, { t: 'Produto' }, { t: 'Valor', num: 1 }, { t: 'Status' }],
        (j.orders || []).slice(0, 50).map(function (o) {
          var pill = o.status === 'paid'
            ? '<span class="pill paid">PAGO</span>'
            : '<span class="pill pending">PENDENTE</span>';
          return [fmtDataHora(o.createdAt), esc(o.nome) + '<br><span style="color:var(--muted);font-size:11px">' + esc(o.email) + '</span>', esc(o.label), o.price, pill];
        }),
        'Nenhum pedido no período.'
      );
    });
  }

  function renderAbandoned() {
    api('abandoned?days=' + state.days).then(function (r) { return r.json(); }).then(function (j) {
      $('abandoned').innerHTML = table(
        [{ t: 'Quando' }, { t: 'Cliente' }, { t: 'Produto' }, { t: 'Valor', num: 1 }, { t: 'Recuperar' }],
        (j.abandoned || []).slice(0, 50).map(function (o) {
          var phone = String(o.telefone || '').replace(/\D/g, '');
          var wa = phone
            ? '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/55' + phone +
              '?text=' + encodeURIComponent('Oi ' + (o.nome || '').split(' ')[0] + '! Vi que você gerou o PIX do ' + o.label + ' mas não finalizou. Posso te ajudar?') +
              '">💬 WhatsApp</a>'
            : '—';
          return [fmtDataHora(o.createdAt), esc(o.nome) + '<br><span style="color:var(--muted);font-size:11px">' + esc(o.email) + '</span>', esc(o.label), o.price, wa];
        }),
        'Nenhum PIX abandonado. 🎉'
      );
    });
  }

  // ---------- Banner de configuração ----------
  function renderBanner(d) {
    var msgs = [];
    if (d.storage === 'memory') msgs.push('⚠️ Armazenamento temporário em uso — métricas podem zerar. (Netlify Blobs indisponível)');
    if (d.provider === 'stub') msgs.push('⚠️ Gateway em modo simulado — chaves da AssetPay não configuradas.');
    if (!d.telegram) msgs.push('💡 Notificação de venda no Telegram desativada — configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no Netlify.');
    var b = $('banner');
    b.innerHTML = msgs.join('<br>');
    b.style.display = msgs.length ? 'block' : 'none';
  }

  // ---------- Carregar tudo ----------
  function load() {
    api('summary?days=' + state.days).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      state.data = d;
      renderBanner(d);
      renderKpis(d);
      renderChart(d);
      renderFunnel(d);
      renderProducts(d);
      renderUtm(d);
      $('atualizado').textContent = 'Atualizado às ' + new Date(d.generatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    }).catch(function () { /* sessão expirada já tratada */ });
    renderOrders();
    renderAbandoned();
  }

  // ---------- Controles ----------
  document.querySelectorAll('.chip[data-days]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.chip[data-days]').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      state.days = parseInt(btn.dataset.days, 10);
      load();
    });
  });
  document.querySelectorAll('.chip[data-metric]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.chip[data-metric]').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      state.metric = btn.dataset.metric;
      if (state.data) renderChart(state.data);
    });
  });
  $('csv').addEventListener('click', function () {
    api('export.csv?days=' + state.days).then(function (r) { return r.blob(); }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pedidos.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  function boot() {
    $('login').style.display = 'none';
    $('login-erro').style.display = 'none';
    $('app').style.display = 'block';
    load();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(load, 60000);
  }

  // Sessão existente? entra direto.
  if (key()) {
    fetch('/api/admin/ping', { headers: { 'x-admin-key': key() } }).then(function (r) {
      if (r.ok) boot(); else logout();
    });
  }
})();
