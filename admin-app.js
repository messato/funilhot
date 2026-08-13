/* Painel /admin — consome /api/admin/* e desenha tudo sem dependências externas. */
(function () {
  'use strict';

  var ORANGE = '#7c5cff', ORANGE2 = '#22d3ee', BAR = 'rgba(255,255,255,0.09)', MUTED = '#6f6f97';
  var state = { days: 7, metric: 'revenue', data: null, orders: [], orderStatus: '', orderQuery: '', timer: null, seenPaid: null, audio: null };

  var $ = function (id) { return document.getElementById(id); };
  var svgIcon = function (id) { return '<svg class="ic"><use href="#ic-' + id + '"></use></svg>'; };
  var el = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  var brl = function (c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var todayBRT = function () { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); };

  // ---------- auth ----------
  function token() { return sessionStorage.getItem('admin_token') || ''; }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'x-admin-key': token() }, opts.headers || {});
    return fetch('/api/admin/' + path, opts).then(function (r) {
      if (r.status === 401) { logout(); throw new Error('unauthorized'); }
      return r;
    });
  }
  function logout() {
    sessionStorage.removeItem('admin_token');
    if (state.timer) clearInterval(state.timer);
    $('app').classList.remove('on');
    $('login').style.display = 'flex';
  }
  function doLogin() {
    var pass = $('senha').value;
    if (!pass) return;
    initAudio();
    $('login-erro').textContent = 'Entrando…';
    fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }),
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); }).then(function (res) {
      if (res.s === 200 && res.j.token) {
        sessionStorage.setItem('admin_token', res.j.token);
        boot();
      } else if (res.s === 429) {
        $('login-erro').textContent = 'Muitas tentativas. Aguarde alguns minutos.';
      } else {
        $('login-erro').textContent = 'Senha incorreta.';
      }
    }).catch(function () { $('login-erro').textContent = 'Erro de conexão.'; });
  }
  $('entrar').addEventListener('click', doLogin);
  $('senha').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('btn-sair').addEventListener('click', logout);

  // ---------- alerta sonoro de venda ----------
  function initAudio() { try { if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)(); if (state.audio.state === 'suspended') state.audio.resume(); } catch (e) { /* sem áudio */ } }
  function beep() {
    if (!state.audio) return;
    [880, 1320].forEach(function (freq, i) {
      var o = state.audio.createOscillator(), g = state.audio.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      var t = state.audio.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g); g.connect(state.audio.destination); o.start(t); o.stop(t + 0.14);
    });
  }

  // ---------- deltas ----------
  function delta(curr, prev, moneyMode) {
    if (!prev) return '<span class="delta flat">novo</span>';
    var pct = Math.round(((curr - prev) / prev) * 100);
    var cls = pct === 0 ? 'flat' : (pct > 0 ? 'up' : 'down');
    var arrow = pct === 0 ? '•' : (pct > 0 ? '▲' : '▼');
    return '<span class="delta ' + cls + '">' + arrow + ' ' + Math.abs(pct) + '%</span>';
  }

  // ---------- KPIs (Vision UI) + usuários ativos ----------
  function deltaKd(curr, prev) {
    if (!prev) return '<span class="kd flat">novo</span>';
    var pct = Math.round((curr - prev) / prev * 100);
    var cls = pct === 0 ? 'flat' : (pct > 0 ? 'up' : 'down');
    return '<span class="kd ' + cls + '">' + (pct > 0 ? '+' : '') + pct + '%</span>';
  }
  function vuiKpi(ic, label, value, dl) {
    return '<div class="vui-kpi"><div class="kx"><div class="kl">' + label + '</div><div class="kv">' + value + ' ' + dl + '</div></div><div class="ki">' + svgIcon(ic) + '</div></div>';
  }
  function renderHero(d) {
    var k = d.kpis, p = d.prevKpis;
    if ($('hero')) $('hero').innerHTML =
      vuiKpi('money', 'Faturamento', brl(k.gross), deltaKd(k.gross, p.gross)) +
      vuiKpi('cart', 'Vendas pagas', String(k.paidCount), deltaKd(k.paidCount, p.paidCount)) +
      vuiKpi('people', 'Visitas', String(k.visits), deltaKd(k.visits, p.visits)) +
      vuiKpi('bank', 'Líquido', brl(k.net), deltaKd(k.net, p.net));

    if ($('au-delta')) { var dv = k.visits - (p.visits || 0); $('au-delta').textContent = '(' + (dv >= 0 ? '+' : '') + dv + ')'; $('au-delta').className = 'delta ' + (dv >= 0 ? 'up' : 'down'); }
    var vis = k.visits || 0;
    var stats = [
      { ic: 'people', l: 'Visitas', v: String(k.visits), bar: 100 },
      { ic: 'flame', l: 'PIX gerados', v: String(k.pixCount), bar: vis ? Math.min(100, Math.round(k.pixCount / vis * 100)) : 0 },
      { ic: 'cart', l: 'Vendas', v: String(k.paidCount), bar: vis ? Math.min(100, Math.round(k.paidCount / vis * 100)) : 0 },
      { ic: 'money', l: 'Faturamento', v: brl(k.gross), bar: k.gross ? Math.round(k.net / k.gross * 100) : 0 },
    ];
    if ($('mini')) $('mini').innerHTML = stats.map(function (s) {
      return '<div class="au-stat"><div class="as-top"><span class="as-ic">' + svgIcon(s.ic) + '</span>' + s.l + '</div><div class="as-v">' + s.v + '</div><div class="as-bar"><i style="width:' + Math.max(4, s.bar) + '%"></i></div></div>';
    }).join('');
  }
  // Tabela "Sales by Country" (por estado) ao lado do globo
  function renderMapaVui() {
    var box = $('mapa-vui'); if (!box) return;
    var paid = (state.orders || []).filter(function (o) { return o.status === 'paid'; });
    var by = {}, total = 0;
    paid.forEach(function (o) { var uf = ufFromPhone(o.telefone) || '??'; by[uf] = by[uf] || { c: 0, rev: 0 }; by[uf].c++; by[uf].rev += o.amount; total += o.amount; });
    var arr = Object.keys(by).map(function (uf) { return { uf: uf, c: by[uf].c, rev: by[uf].rev }; }).sort(function (a, b) { return b.rev - a.rev; }).slice(0, 5);
    if (!arr.length) { box.innerHTML = '<div class="sub" style="padding:12px 0">Sem vendas com telefone no período ainda.</div>'; return; }
    box.innerHTML = '<table class="vc-table"><tbody>' + arr.map(function (a) {
      var share = total ? Math.round(a.rev / total * 100) : 0;
      return '<tr><td><span class="vc-flag">' + esc(a.uf) + '</span></td>' +
        '<td class="vc-cell"><div class="cl">Estado</div><div class="cv">' + esc(a.uf) + '</div></td>' +
        '<td class="vc-cell"><div class="cl">Vendas</div><div class="cv">' + a.c + '</div></td>' +
        '<td class="vc-cell"><div class="cl">Valor</div><div class="cv">' + brl(a.rev) + '</div></td>' +
        '<td class="vc-cell"><div class="cl">Part.</div><div class="cv">' + share + '%</div></td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ---------- meta ----------
  function donut(pct) {
    var r = 34, c = 2 * Math.PI * r, off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
    return '<svg class="gauge" viewBox="0 0 92 92">' +
      '<defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>' +
      '<circle cx="46" cy="46" r="' + r + '" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="8"/>' +
      '<circle cx="46" cy="46" r="' + r + '" fill="none" stroke="url(#gg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 46 46)"/>' +
      '<text x="46" y="47" text-anchor="middle" dominant-baseline="middle">' + pct + '%</text></svg>';
  }
  function renderGoal(d) {
    var g = d.goal;
    if (!g.amount) {
      $('goal-body').innerHTML = '<div class="goal-sub">Nenhuma meta definida.</div>' +
        '<button class="btn-o" id="goal-set" style="margin-top:6px">Definir meta do mês</button>';
      $('goal-set').addEventListener('click', openGoalModal);
      return;
    }
    var pct = Math.min(100, Math.round(g.monthRevenue / g.amount * 100));
    var onTrack = g.projection >= g.amount;
    $('goal-body').innerHTML =
      '<div class="goal-head">' + donut(pct) +
      '<div><div class="goal-val">' + brl(g.monthRevenue) + '</div>' +
      '<div class="goal-sub">de ' + brl(g.amount) + ' · meta do mês</div></div></div>' +
      '<div class="track"><i style="width:' + pct + '%"></i></div>' +
      '<div class="goal-legend"><span>dia ' + g.elapsed + '/' + g.daysInMonth + '</span>' +
      '<span class="' + (onTrack ? 'roas-tag good' : 'roas-tag bad') + '">projeção ' + brl(g.projection) + '</span></div>' +
      '<div class="prod-mini" id="goal-prods"></div>';
    var top = (d.products || []).slice(0, 4);
    $('goal-prods').innerHTML = top.map(function (p) {
      return '<div class="prod-cell"><div class="pn">' + esc(p.label) + '</div><div class="pv">' + brl(p.revenue) + '</div><div class="pc">' + p.paid + ' venda(s)</div></div>';
    }).join('') || '<div class="sub">Sem vendas ainda.</div>';
  }

  // ---------- gráfico ----------
  var METRIC = { revenue: { label: 'receita no período', money: true }, pago: { label: 'vendas no período', money: false }, pix: { label: 'PIX gerados no período', money: false }, visits: { label: 'visitas no período', money: false } };
  function renderChart(d) {
    var rows = d.daily, m = state.metric, money = METRIC[m].money;
    var vals = rows.map(function (r) { return r[m] || 0; });
    var total = vals.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, vals.concat([1]));
    var peak = vals.indexOf(Math.max.apply(null, vals));

    if ($('chart-big')) $('chart-big').textContent = money ? brl(total) : total.toLocaleString('pt-BR');
    if ($('chart-cap')) $('chart-cap').textContent = METRIC[m].label;

    var W = Math.max(480, rows.length * 34), H = 200, padL = 8, padB = 22, padT = 14;
    var plotW = W - padL, plotH = H - padT - padB, bw = Math.min(11, Math.max(5, (plotW / rows.length) - 8));

    var svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + METRIC[m].label + '">';
    svg += '<defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="rgba(255,255,255,.28)"/></linearGradient></defs>';
    rows.forEach(function (r, i) {
      var v = r[m] || 0, h = Math.round(plotH * v / max);
      var x = padL + (plotW / rows.length) * i + ((plotW / rows.length) - bw) / 2, y = padT + plotH - h;
      svg += '<rect class="cbar" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, 2) + '" rx="4" fill="url(#og)"/>';
      if (rows.length <= 14 || i % Math.ceil(rows.length / 12) === 0) {
        svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="9.5" fill="' + MUTED + '">' + r.day.slice(8) + '/' + r.day.slice(5, 7) + '</text>';
      }
    });
    svg += '</svg>';
    $('chart').innerHTML = svg;

    var tip = $('tip'), wrap = $('chart').parentNode;
    $('chart').querySelectorAll('.cbar').forEach(function (rect) {
      rect.addEventListener('mouseenter', function () {
        var i = +rect.getAttribute('data-i'), r = rows[i];
        rect.setAttribute('opacity', '0.6');
        var val = money ? brl(r[m] || 0) : (r[m] || 0);
        tip.innerHTML = '<b>' + r.day.slice(8) + '/' + r.day.slice(5, 7) + '</b>' + val + (m === 'revenue' ? ' · ' + r.pago + ' venda(s)' : '');
        var bx = +rect.getAttribute('x'), by = +rect.getAttribute('y');
        tip.style.opacity = '1';
        tip.style.left = Math.min(wrap.clientWidth - 120, Math.max(4, bx - 30)) + 'px';
        tip.style.top = Math.max(0, by - 46) + 'px';
      });
      rect.addEventListener('mouseleave', function () { rect.setAttribute('opacity', '1'); tip.style.opacity = '0'; });
    });
  }

  // ---------- gráfico de área "Visão de vendas" (Vision UI) ----------
  function smoothPath(pts) {
    if (!pts.length) return '';
    if (pts.length < 2) return 'M' + pts[0][0] + ',' + pts[0][1];
    var d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }
  function renderArea(d) {
    var host = $('area'); if (!host || !d) return;
    var k = d.kpis, p = d.prevKpis;
    if ($('area-delta')) { var pct = p.gross ? Math.round((k.gross - p.gross) / p.gross * 100) : 0; $('area-delta').textContent = (pct >= 0 ? '+' : '') + pct + '% vs anterior'; $('area-delta').className = 'delta ' + (pct >= 0 ? 'up' : 'down'); }
    var rows = d.daily || [], vals = rows.map(function (r) { return r.revenue || 0; });
    if (!vals.length) { host.innerHTML = ''; return; }
    var W = Math.max(480, rows.length * 40), H = 240, padL = 40, padR = 10, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var max = Math.max.apply(null, vals.concat([1])) * 1.15;
    var xx = function (i) { return padL + (rows.length <= 1 ? plotW / 2 : plotW * i / (rows.length - 1)); };
    var yy = function (v) { return padT + plotH - (plotH * v / max); };
    var fmtY = function (c) { var r = c / 100; return r >= 1000 ? ('R$' + Math.round(r / 1000) + 'k') : ('R$' + Math.round(r)); };
    var pts = vals.map(function (v, i) { return [xx(i), yy(v)]; });
    var line = smoothPath(pts);
    var area = line + ' L' + xx(rows.length - 1).toFixed(1) + ',' + (padT + plotH) + ' L' + xx(0).toFixed(1) + ',' + (padT + plotH) + ' Z';
    var grid = '';
    for (var g = 0; g <= 4; g++) { var gy = padT + plotH * g / 4; grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="rgba(255,255,255,.06)" stroke-dasharray="4 6"/>'; grid += '<text x="' + (padL - 8) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="9" fill="' + MUTED + '">' + fmtY(max * (1 - g / 4)) + '</text>'; }
    var xl = '';
    rows.forEach(function (r, i) { if (rows.length <= 14 || i % Math.ceil(rows.length / 12) === 0) xl += '<text x="' + xx(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9" fill="' + MUTED + '">' + r.day.slice(8) + '/' + r.day.slice(5, 7) + '</text>'; });
    host.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Visão de vendas">' +
      '<defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(33,212,253,.45)"/><stop offset="1" stop-color="rgba(33,212,253,0)"/></linearGradient>' +
      '<linearGradient id="lineG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#21d4fd"/><stop offset="1" stop-color="#2152ff"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#areaG)"/><path d="' + line + '" fill="none" stroke="url(#lineG)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' + xl + '</svg>';
  }

  // ---------- funil ----------
  function renderFunnel(d) {
    var max = Math.max.apply(null, d.funnel.map(function (f) { return f.count; }).concat([1]));
    $('funnel').innerHTML = d.funnel.map(function (f, i) {
      var w = Math.round(f.count / max * 100);
      return '<div class="fn-row"><div class="fn-label">' + esc(f.step) + '</div>' +
        '<div class="fn-track"><div class="fn-bar" style="width:' + w + '%"></div></div>' +
        '<div class="fn-num">' + f.count + (i > 0 ? ' <span class="pct">(' + f.rate + '%)</span>' : '') + '</div></div>';
    }).join('');
  }

  // ---------- tabelas ----------
  function tableHTML(headers, rows, empty) {
    if (!rows.length) return '<div class="empty">' + empty + '</div>';
    return '<table class="data"><thead><tr>' + headers.map(function (h) { return '<th class="' + (h.num ? 'num' : '') + '">' + h.t + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td class="' + (headers[i].num ? 'num' : '') + '">' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function renderUtm(d) {
    $('utm').innerHTML = tableHTML(
      [{ t: 'Origem' }, { t: 'Visitas', num: 1 }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }, { t: 'Gasto', num: 1 }, { t: 'ROAS', num: 1 }],
      d.utm.map(function (u) {
        var roas = u.spend ? '<span class="roas-tag ' + (u.revenue >= u.spend ? 'good' : 'bad') + '">' + u.roas + 'x</span>' : '<span class="sub">—</span>';
        return [esc(u.source) + (u.campaign ? '<div class="sub">' + esc(u.campaign) + '</div>' : ''), u.views, u.pago, brl(u.revenue), u.spend ? brl(u.spend) : '<span class="sub">—</span>', roas];
      }),
      'Sem tráfego registrado ainda.'
    );
  }
  function renderProducts(d) {
    $('products').innerHTML = tableHTML(
      [{ t: 'Produto' }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }],
      d.products.map(function (p) { return [esc(p.label), p.paid, brl(p.revenue)]; }),
      'Nenhuma venda no período.'
    );
  }

  // ---------- heatmap ----------
  var WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  function renderHeat(d) {
    var heat = d.heatmap, max = 1;
    heat.forEach(function (row) { row.forEach(function (c) { if (c > max) max = c; }); });
    var html = '<table><thead><tr><th></th>';
    for (var h = 0; h < 24; h++) html += '<th>' + (h % 3 === 0 ? h : '') + '</th>';
    html += '</tr></thead><tbody>';
    heat.forEach(function (row, wd) {
      html += '<tr><td class="rowlabel">' + WD[wd] + '</td>';
      row.forEach(function (c) {
        var a = c ? (0.18 + 0.82 * c / max) : 0;
        var bg = c ? 'rgba(255,106,43,' + a.toFixed(2) + ')' : BAR;
        html += '<td><div class="cell" style="background:' + bg + '" title="' + WD[wd] + ' ' + '"></div></td>';
      });
      html += '</tr>';
    });
    $('heat').innerHTML = html + '</tbody></table>';
  }

  // ---------- pedidos / abandonados ----------
  var fmtDH = function (ts) { return ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
  var piiOn = function () { return !(state.flags && state.flags.mascarar_pii === false); };
  var maskEmail = function (e) { e = String(e || ''); if (!piiOn()) return e; var at = e.indexOf('@'); return at < 2 ? e : e.slice(0, 2) + '***' + e.slice(at); };
  var maskPhone = function (p) { p = String(p || '').replace(/\D/g, ''); if (!piiOn()) return p; return p.length < 6 ? p : p.slice(0, 2) + '*****' + p.slice(-2); };

  function renderOrders() {
    var rows = state.orders.filter(function (o) {
      if (state.orderStatus && o.status !== state.orderStatus) return false;
      if (state.orderQuery) {
        var q = state.orderQuery.toLowerCase();
        if (!((o.nome || '').toLowerCase().indexOf(q) >= 0 || (o.email || '').toLowerCase().indexOf(q) >= 0 || (o.id || '').toLowerCase().indexOf(q) >= 0)) return false;
      }
      return true;
    }).slice(0, 60);
    $('orders').innerHTML = tableHTML(
      [{ t: 'Quando' }, { t: 'Cliente' }, { t: 'Produto' }, { t: 'Origem' }, { t: 'Valor', num: 1 }, { t: 'Status' }],
      rows.map(function (o) {
        var pill = o.status === 'paid' ? '<span class="pill paid"><span class="pd"></span>PAGO</span>' : '<span class="pill pending"><span class="pd"></span>PENDENTE</span>';
        return [fmtDH(o.createdAt), esc(o.nome) + '<div class="sub">' + esc(maskEmail(o.email)) + '</div>', esc(o.label), esc(o.utmSource || '—'), o.price, pill];
      }),
      'Nenhum pedido no período.'
    );
  }
  function renderAbandoned(list) {
    var regenOn = !(state.flags && state.flags.regenerar_pix === false);
    $('abandoned').innerHTML = tableHTML(
      [{ t: 'Quando' }, { t: 'Cliente' }, { t: 'Produto' }, { t: 'Valor', num: 1 }, { t: 'Recuperar' }],
      list.slice(0, 60).map(function (o) {
        var phone = String(o.telefone || '').replace(/\D/g, '');
        var msg = 'Oi ' + (o.nome || '').split(' ')[0] + '! Vi que você gerou o PIX do ' + o.label + ' mas não finalizou. Posso te ajudar a concluir?';
        var wa = phone ? '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/55' + phone + '?text=' + encodeURIComponent(msg) + '">💬 WhatsApp</a>' : '<span class="sub">sem telefone</span>';
        var regen = regenOn ? ' &nbsp;<span class="reveal regen-pix" data-id="' + esc(o.id) + '">🔄 Novo PIX</span>' : '';
        return [fmtDH(o.createdAt), esc(o.nome) + '<div class="sub">' + esc(maskPhone(o.telefone)) + '</div>', esc(o.label), o.price, wa + regen];
      }),
      'Nenhum PIX abandonado. 🎉'
    );
  }
  // Regenerar PIX de um abandonado → mostra o novo código pra copiar/enviar.
  if ($('abandoned')) $('abandoned').addEventListener('click', function (e) {
    var b = e.target.closest('.regen-pix'); if (!b) return;
    b.textContent = 'gerando…';
    api('regen-pix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.id }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) { b.textContent = j.error === 'sem_cpf' ? 'sem CPF salvo' : (j.error === 'ja_pago' ? 'já pago' : 'erro'); return; }
        b.textContent = '🔄 Novo PIX';
        var body = '<div class="sub" style="margin-bottom:6px">Novo código PIX (' + esc(j.data.price) + ') — envie pro cliente:</div>' +
          '<div class="pix-code" style="word-break:break-all;background:#0d0d0d;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;font-size:12px" id="regen-code">' + esc(j.data.brcode) + '</div>' +
          (j.data.qrImage ? '<img src="' + j.data.qrImage + '" alt="QR" style="display:block;margin:10px auto 0;width:170px;border-radius:10px;background:#fff">' : '');
        var ov = modal('PIX regenerado', body, function (o, close) {
          try { navigator.clipboard.writeText(j.data.brcode); } catch (er) { /* */ }
          close();
        });
        var ok = ov.querySelector('[data-ok]'); if (ok) ok.textContent = 'Copiar código';
      }).catch(function () { b.textContent = 'erro'; });
  });

  // ---------- banner ----------
  function renderBanner(d) {
    var msgs = [];
    if (d.storage === 'memory') msgs.push('⚠️ Armazenamento temporário — métricas podem zerar. (' + (d.storageDetail || 'Blobs indisponível') + ')');
    if (d.provider === 'stub') msgs.push('⚠️ Gateway em modo simulado (chaves da AssetPay não configuradas).');
    if (!d.telegram) msgs.push('💡 Notificações no Telegram desativadas — configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.');
    $('foot-provider').textContent = d.provider === 'assetpay' ? 'AssetPay conectada' : 'Modo simulado';
    $('foot-storage').textContent = d.storage === 'blobs' ? 'dados persistentes' : 'armazenamento temporário';
    var b = $('banner'); b.innerHTML = msgs.join('<br>'); b.style.display = msgs.length ? 'block' : 'none';
  }

  // ---------- modais ----------
  function modal(title, bodyHTML, onOk) {
    var ov = el('div', 'modal-ov');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px';
    ov.innerHTML = '<div style="background:#1a1a1a;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px;width:100%;max-width:360px">' +
      '<h2 style="font-size:16px;margin-bottom:14px">' + title + '</h2>' + bodyHTML +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn-ghost" data-x style="flex:1">Cancelar</button><button class="btn-o" data-ok style="flex:1">Salvar</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('[data-x]').addEventListener('click', function () { ov.remove(); });
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector('[data-ok]').addEventListener('click', function () { onOk(ov, function () { ov.remove(); }); });
    return ov;
  }
  var IN = 'width:100%;padding:11px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#0d0d0d;color:#fff;font-size:14px;margin-bottom:10px;outline:none';
  function openGoalModal() {
    var cur = state.data && state.data.goal.amount ? (state.data.goal.amount / 100) : '';
    modal('Meta do mês', '<label class="sub">Valor da meta (R$)</label><input id="m-goal" type="number" step="1" value="' + cur + '" style="' + IN + '" placeholder="30000">', function (ov, close) {
      var v = parseFloat(ov.querySelector('#m-goal').value) || 0;
      api('goal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: v }) }).then(function () { close(); load(); });
    });
  }
  function openSpendModal() {
    modal('Lançar gasto de tráfego', '<label class="sub">Data</label><input id="m-day" type="date" value="' + todayBRT() + '" style="' + IN + '">' +
      '<label class="sub">Origem (igual ao utm_source do anúncio)</label><input id="m-src" placeholder="instagram" style="' + IN + '">' +
      '<label class="sub">Valor gasto no dia (R$)</label><input id="m-amt" type="number" step="0.01" placeholder="150" style="' + IN + '">',
      function (ov, close) {
        var body = { day: ov.querySelector('#m-day').value, source: ov.querySelector('#m-src').value || '(geral)', amount: parseFloat(ov.querySelector('#m-amt').value) || 0 };
        api('spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function () { close(); load(); });
      });
  }
  $('goal-edit').addEventListener('click', openGoalModal);

  // ---------- carregar ----------
  function load() {
    api('summary?days=' + state.days).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      state.data = d;
      renderBanner(d); renderHero(d); renderGoal(d); renderChart(d); renderArea(d); renderFunnel(d); renderUtm(d); renderProducts(d); renderHeat(d); renderComputed();
      $('foot-updated').textContent = 'Atualizado às ' + new Date(d.generatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' · atualiza sozinho a cada 60s';
    }).catch(function () {});

    api('orders?days=' + state.days).then(function (r) { return r.json(); }).then(function (j) {
      state.orders = j.orders || [];
      $('nav-orders').textContent = state.orders.length;
      renderOrders(); renderComputed();
      // alerta de venda nova
      var paidIds = state.orders.filter(function (o) { return o.status === 'paid'; }).map(function (o) { return o.id; });
      if (state.seenPaid === null) { state.seenPaid = {}; paidIds.forEach(function (id) { state.seenPaid[id] = 1; }); }
      else { var novos = paidIds.filter(function (id) { return !state.seenPaid[id]; }); if (novos.length) { if (!(state.flags && state.flags.som_venda === false)) beep(); novos.forEach(function (id) { state.seenPaid[id] = 1; }); } }
    }).catch(function () {});

    api('abandoned?days=' + state.days).then(function (r) { return r.json(); }).then(function (j) {
      state.abandonedList = j.abandoned || [];
      state.abandonedCount = state.abandonedList.length;
      $('nav-aband').textContent = state.abandonedCount;
      renderAbandoned(state.abandonedList); renderCoach();
      if (state.view === 'remarketing') renderRemarketing();
    }).catch(function () {});
  }

  // ---------- controles ----------
  $('period').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('period').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.days = +b.dataset.days; load();
  });
  $('metric').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('metric').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.metric = b.dataset.metric; if (state.data) renderChart(state.data);
  });
  $('order-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('order-filter').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.orderStatus = b.dataset.status; renderOrders();
  });
  $('order-search').addEventListener('input', function (e) { state.orderQuery = e.target.value; renderOrders(); });
  $('side-search').addEventListener('input', function (e) { state.orderQuery = e.target.value; $('order-search').value = e.target.value; renderOrders(); showView('vendas'); });
  $('btn-refresh').addEventListener('click', load);
  $('btn-csv').addEventListener('click', function () {
    api('export.csv?days=' + state.days).then(function (r) { return r.blob(); }).then(function (blob) {
      var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'pedidos.csv'; a.click(); URL.revokeObjectURL(a.href);
    });
  });
  // ---------- navegação por abas (views) ----------
  var VIEWS = {
    overview: { t: 'Visão geral', s: 'Os números que importam agora', data: true },
    vendas: { t: 'Vendas', s: 'Pedidos e clientes', data: true },
    abandonados: { t: 'PIX abandonados', s: 'Recupere quem gerou e não pagou', data: true },
    membros: { t: 'Membros', s: 'Sua base de assinantes e recorrência', data: false },
    remarketing: { t: 'Remarketing', s: 'Dispare mensagens segmentadas no WhatsApp', data: false },
    publicacoes: { t: 'Publicações', s: 'Publique um vídeo em várias redes de uma vez', data: false },
    funil: { t: 'Funil de conversão', s: 'Onde as pessoas param', data: true },
    trafego: { t: 'Tráfego e ROAS', s: 'Retorno por origem de tráfego', data: true },
    metas: { t: 'Metas & produtos', s: 'Progresso do mês', data: true },
    financeiro: { t: 'Financeiro', s: 'Lucro real, impostos e recebíveis', data: true },
    insights: { t: 'IA & Insights', s: 'Resumo, próximas ações e previsão', data: true },
    crescimento: { t: 'Crescimento', s: 'Links, público, prova social, depoimentos e afiliados', data: false },
    ofertas: { t: 'Ofertas & cupons', s: 'Cupons de desconto e order bump do checkout', data: false },
    bot: { t: 'Bot do Telegram', s: 'Prévias, grupos e acesso automático ao VIP', data: false },
    integracoes: { t: 'Integrações', s: 'Webhooks e backup dos seus dados', data: false },
    config: { t: 'Página & Configurações', s: 'Sua página de vendas, preços, links e textos', data: false },
    recursos: { t: 'Recursos', s: 'Ligue e desligue funcionalidades', data: false },
  };
  function csvVisible() { return (state.view === 'vendas' || state.view === 'overview') && !(state.flags && state.flags.export_csv === false); }
  function setCsv() { var b = $('btn-csv'); if (b) b.style.display = csvVisible() ? '' : 'none'; }
  function showView(name) {
    if (!VIEWS[name]) name = 'overview';
    state.view = name;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('on', v.dataset.view === name); });
    document.querySelectorAll('.nav-item[data-view]').forEach(function (n) { n.classList.toggle('active', n.dataset.view === name); });
    $('view-title').textContent = VIEWS[name].t;
    $('head-sub').textContent = VIEWS[name].s;
    $('period').style.display = VIEWS[name].data ? '' : 'none';
    setCsv();
    if (name === 'overview' && state.data) { renderChart(state.data); renderArea(state.data); renderMapaVui(); } // re-mede ao exibir
    if (name === 'overview' && window.__globeResize) setTimeout(window.__globeResize, 30);
    if (name === 'publicacoes') loadSocialHistory();
    if (name === 'membros') { loadMembers(); renderNiveis(); }
    if (name === 'remarketing') renderRemarketing();
    if (name === 'crescimento') renderCrescimento();
    if (name === 'ofertas') renderOfertas();
    if (name === 'bot') renderBot();
    if (name === 'integracoes') renderIntegracoes();
    if (name === 'config') renderPagina();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav-item[data-view]').forEach(function (item) {
    item.addEventListener('click', function () { showView(item.dataset.view); });
  });
  $('btn-spend').addEventListener('click', openSpendModal);

  // ---------- recursos (on/off) ----------
  function applyFlags() {
    var f = state.flags || {};
    var show = function (id, on) { var e = $(id); if (e) e.style.display = (on === false) ? 'none' : ''; };
    show('sec-goal', f.card_meta); show('sec-traffic', f.card_roas); show('card-produtos', f.card_produtos);
    show('sec-funnel', f.card_funil); show('sec-heat', f.card_heatmap); show('sec-abandoned', f.card_abandonados);
    var navPub = document.querySelector('.nav-item[data-view="publicacoes"]');
    if (navPub) navPub.style.display = (f.social_publisher === false) ? 'none' : '';
    var pgCard = $('sec-pagina');
    if (pgCard) pgCard.style.display = (f.page_editor === false) ? 'none' : '';
    var showNav = function (view, on) { var n = document.querySelector('.nav-item[data-view="' + view + '"]'); if (n) n.style.display = on ? '' : 'none'; };
    // Financeiro
    show('sec-dre', f.dre); show('sec-recebiveis', f.recebiveis);
    showNav('financeiro', (f.dre !== false) || (f.recebiveis !== false));
    // IA & Insights
    show('sec-ia-resumo', f.ia_resumo); show('sec-coach', f.modo_coach); show('sec-forecast', f.ia_forecast);
    showNav('insights', (f.ia_resumo !== false) || (f.modo_coach !== false) || (f.ia_forecast !== false));
    // Membros
    show('sec-mrr', f.renovacao_mrr); show('sec-membros', f.aba_membros);
    show('sec-gamificacao', f.gamificacao_membros); show('sec-coorte', f.coorte_retencao); show('sec-niveis', f.niveis_vip);
    showNav('membros', (f.aba_membros !== false) || (f.renovacao_mrr !== false) || (f.gamificacao_membros !== false) || (f.coorte_retencao !== false) || (f.niveis_vip !== false));
    showNav('remarketing', (f.recuperacao_auto !== false) || (f.winback !== false) || (f.central_disparos !== false) || (f.boas_vindas !== false) || (f.reativacao_inativo !== false));
    // Insights de tráfego
    show('sec-criativos', f.ranking_criativos); show('sec-mapa', f.mapa_estado);
    show('sec-funil-origem', f.funil_por_origem); show('sec-antifraude', f.antifraude); show('sec-comparar', f.comparar_periodos);
    // Crescimento
    show('sec-utm', f.utm_builder); show('sec-publico-meta', f.publico_meta); show('sec-prova', f.prova_social);
    show('sec-depoimentos', f.depoimentos); show('sec-afiliados', f.afiliados); show('sec-embaixadores', f.embaixadores);
    showNav('crescimento', (f.utm_builder !== false) || (f.publico_meta !== false) || (f.prova_social !== false) || (f.depoimentos !== false) || (f.afiliados !== false) || (f.embaixadores !== false));
    // Ofertas & cupons
    show('sec-cupons', f.cupons); show('sec-orderbump', f.order_bump); show('sec-quiz', f.quiz); show('sec-abtest', f.ab_preco);
    showNav('ofertas', (f.cupons !== false) || (f.order_bump !== false) || (f.quiz !== false) || (f.ab_preco !== false));
    // Integrações
    show('sec-webhooks', f.webhooks); show('sec-backup', f.backup);
    showNav('integracoes', (f.webhooks !== false) || (f.backup !== false));
    // Botões da topbar (modo TV / PDF)
    var btnTv = $('btn-tv'); if (btnTv) btnTv.style.display = (f.modo_tv === false) ? 'none' : '';
    var btnPdf = $('btn-pdf'); if (btnPdf) btnPdf.style.display = (f.relatorio_pdf === false) ? 'none' : '';
    resetIdle();
    setCsv();
  }
  function renderFeatures() {
    var q = (state.featQuery || '').toLowerCase(), byCat = {}, ativos = 0, total = 0;
    (state.features || []).forEach(function (f) {
      if (f.status === 'ativo') total++;
      if (f.status === 'ativo' && state.flags[f.id]) ativos++;
      if (q && (f.label + ' ' + f.desc).toLowerCase().indexOf(q) < 0) return;
      (byCat[f.cat] = byCat[f.cat] || []).push(f);
    });
    var html = '';
    Object.keys(byCat).forEach(function (cat) {
      html += '<div class="feat-cat">' + esc(cat) + '</div>';
      byCat[cat].forEach(function (f) {
        var on = !!state.flags[f.id], soon = f.status !== 'ativo';
        var badge = soon ? '<span class="badge-soon">em breve</span>' : (on ? '<span class="badge-on">ativo</span>' : '');
        html += '<div class="feat-row"><div class="fx"><div class="fl">' + esc(f.label) + badge + '</div><div class="fd">' + esc(f.desc) + '</div></div>' +
          '<div class="sw' + (on ? ' on' : '') + (soon ? ' dis' : '') + '" data-fid="' + f.id + '" data-soon="' + (soon ? 1 : 0) + '"></div></div>';
      });
    });
    $('features-list').innerHTML = html;
    $('feat-count').textContent = ativos + ' de ' + total + ' recursos ativos · ' + (state.features || []).length + ' no total';
  }

  // ---------- configurações editáveis ----------
  var PRICE_LABELS = {
    'checkout/mensal': 'Checkout — Mensal', 'checkout/trimestral': 'Checkout — Trimestral', 'checkout/anual': 'Checkout — Anual',
    'upsell/mensal': 'Upsell — Mensal', 'upsell/trimestral': 'Upsell — Trimestral',
    'downsell/mensal': 'Downsell — Mensal', 'downsell/trimestral': 'Downsell — Trimestral',
  };
  function renderSettings() {
    var s = state.settings; if (!s) return;
    $('set-prices').innerHTML = Object.keys(PRICE_LABELS).map(function (k) {
      var reais = ((s.prices[k] || 0) / 100).toFixed(2);
      return '<div class="feat-row"><div class="fx"><div class="fl">' + PRICE_LABELS[k] + '</div></div>' +
        '<input class="set-in price-in" data-key="' + k + '" type="number" step="0.01" value="' + reais + '"></div>';
    }).join('');
    $('set-vip').value = s.vipLink || ''; $('set-support').value = s.supportLink || '';
    $('set-recovery').value = s.recoveryMsg || ''; $('set-abandon').value = s.abandonMinutes || 10;
    if ($('set-tax')) $('set-tax').value = (typeof s.taxRatePct === 'number' ? s.taxRatePct : 6);
    if ($('set-release')) $('set-release').value = (typeof s.pixReleaseDays === 'number' ? s.pixReleaseDays : 1);
  }
  function saveSettings() {
    var prices = {};
    document.querySelectorAll('.price-in').forEach(function (inp) { prices[inp.dataset.key] = Math.round(parseFloat(inp.value || '0') * 100); });
    var patch = {
      prices: prices,
      vipLink: $('set-vip').value, supportLink: $('set-support').value,
      recoveryMsg: $('set-recovery').value, abandonMinutes: parseInt($('set-abandon').value, 10) || 10,
      taxRatePct: parseFloat($('set-tax').value), pixReleaseDays: parseInt($('set-release').value, 10),
    };
    $('set-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) { state.settings = j.settings; renderSettings(); renderComputed(); $('set-status').textContent = '✅ salvo'; setTimeout(function () { $('set-status').textContent = ''; }, 2500); }
      }).catch(function () { $('set-status').textContent = 'erro ao salvar'; });
  }

  function loadConfig() {
    api('features').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return; state.features = j.features; state.flags = j.flags; renderFeatures(); applyFlags();
    }).catch(function () {});
    api('settings').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return; state.settings = j.settings; renderSettings(); renderNiveis(); renderDep(); renderAffList(); renderOfertas(); renderWebhooks(); renderComputed();
    }).catch(function () {});
  }

  $('features-list').addEventListener('click', function (e) {
    var sw = e.target.closest('.sw'); if (!sw || sw.dataset.soon === '1') return;
    var id = sw.dataset.fid, on = !state.flags[id];
    state.flags[id] = on; sw.classList.toggle('on', on);
    api('features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, on: on }) })
      .then(function () { renderFeatures(); applyFlags(); renderComputed(); });
  });
  $('feat-search').addEventListener('input', function (e) { state.featQuery = e.target.value; renderFeatures(); });
  $('set-save').addEventListener('click', saveSettings);

  // ---------- publicações (multi-rede) ----------
  function setSoc(msg) { $('soc-status').textContent = msg || ''; }
  function publishSocial() {
    var file = $('soc-file').files[0];
    var caption = $('soc-caption').value.trim();
    var nets = [].slice.call(document.querySelectorAll('#soc-nets input:checked')).map(function (c) { return c.value; });
    var autoNets = nets.filter(function (n) { return n !== 'kwai'; });
    if (!nets.length) { setSoc('Marque pelo menos uma rede.'); return; }
    if (autoNets.length && !file) { setSoc('Selecione o vídeo.'); return; }
    var fd = new FormData();
    if (file) fd.append('video', file);
    fd.append('caption', caption);
    nets.forEach(function (n) { fd.append('networks', n); });
    $('soc-publish').disabled = true; setSoc('Publicando…');
    fetch('/api/admin/social/post', { method: 'POST', headers: { 'x-admin-key': token() }, body: fd })
      .then(function (r) { if (r.status === 401) { logout(); throw new Error('unauth'); } return r.json(); })
      .then(function (j) {
        $('soc-publish').disabled = false;
        if (!j.ok) { setSoc('Erro: ' + (j.error || 'falhou')); return; }
        var prov = j.post && j.post.provider;
        setSoc(prov === 'stub' ? '✅ Registrado (modo simulado — conecte a agregadora pra publicar de verdade)' : '✅ Publicado!');
        if (nets.indexOf('kwai') >= 0) showKwai(file, caption); else $('soc-kwai').style.display = 'none';
        loadSocialHistory();
      })
      .catch(function () { $('soc-publish').disabled = false; setSoc('Erro de conexão.'); });
  }
  function showKwai(file, caption) {
    var box = $('soc-kwai'); box.style.display = 'block';
    box.innerHTML = '<div class="cap" style="margin-bottom:8px">🟠 <b>Kwai é manual</b> — poste você mesmo com a legenda abaixo:</div>' +
      '<div class="pix-code" style="white-space:pre-wrap">' + esc(caption || '(sem legenda)') + '</div>' +
      '<div style="margin-top:8px">' + (file ? '<a class="btn-ghost" id="soc-kwai-dl">⬇ Baixar vídeo</a> ' : '') +
      '<button class="btn-ghost" id="soc-kwai-copy">Copiar legenda</button> <button class="btn-o" id="soc-kwai-done">Já postei no Kwai</button></div>';
    if (file) { var a = $('soc-kwai-dl'); a.href = URL.createObjectURL(file); a.download = file.name || 'video.mp4'; }
    $('soc-kwai-copy').addEventListener('click', function () { try { navigator.clipboard.writeText(caption || ''); setSoc('Legenda copiada.'); } catch (e) { /* */ } });
    $('soc-kwai-done').addEventListener('click', function () { box.style.display = 'none'; });
  }
  function loadSocialHistory() {
    api('social/posts?days=30').then(function (r) { return r.json(); }).then(function (j) {
      var posts = j.posts || [];
      $('soc-history').innerHTML = tableHTML(
        [{ t: 'Quando' }, { t: 'Legenda' }, { t: 'Redes' }, { t: 'Kwai' }],
        posts.map(function (p) {
          var nets = (p.results || []).map(function (r) { return '<span class="pill ' + (r.status === 'published' ? 'paid' : 'pending') + '"><span class="pd"></span>' + esc(r.network) + '</span>'; }).join(' ') || '<span class="sub">—</span>';
          var kwai = p.kwai === 'pending' ? '<span class="pill pending">pendente</span>' : (p.kwai === 'done' ? '<span class="pill paid">feito</span>' : '<span class="sub">—</span>');
          return [fmtDH(p.createdAt), '<span class="sub">' + esc((p.caption || '').slice(0, 40)) + '</span>', nets, kwai];
        }),
        'Nenhuma publicação ainda.'
      );
    }).catch(function () {});
  }
  $('soc-publish').addEventListener('click', publishSocial);

  // ---------- editor da página (landing) ----------
  function renderPagina() {
    var s = state.settings; if (!s) return;
    $('pg-name').value = s.siteName || '';
    $('pg-user').value = s.siteUser || '';
    $('pg-biotitle').value = s.siteBioTitle || '';
    $('pg-biotext').value = s.siteBioText || '';
    $('pg-stats').value = s.siteStats || '';
    var av = $('pg-avatar-preview'); av.style.display = s.avatarVer ? '' : 'none'; if (s.avatarVer) av.src = '/img/avatar?v=' + s.avatarVer;
    var cp = $('pg-capa-preview'); cp.style.display = s.capaVer ? '' : 'none'; if (s.capaVer) cp.src = '/img/capa?v=' + s.capaVer;
  }
  function uploadImg(name, file) {
    var fd = new FormData(); fd.append('file', file);
    return fetch('/api/admin/media/' + name, { method: 'POST', headers: { 'x-admin-key': token() }, body: fd }).then(function (r) { return r.json(); });
  }
  function savePagina() {
    var patch = {
      siteName: $('pg-name').value, siteUser: $('pg-user').value,
      siteBioTitle: $('pg-biotitle').value, siteBioText: $('pg-biotext').value, siteStats: $('pg-stats').value,
    };
    var avatarFile = $('pg-avatar').files[0], capaFile = $('pg-capa').files[0];
    $('pg-save').disabled = true; $('pg-status').textContent = 'salvando…';
    var jobs = [api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json(); })];
    if (avatarFile) jobs.push(uploadImg('avatar', avatarFile));
    if (capaFile) jobs.push(uploadImg('capa', capaFile));
    Promise.all(jobs).then(function (res) {
      var bad = res.filter(function (x) { return !x || !x.ok; });
      $('pg-save').disabled = false;
      if (bad.length) { $('pg-status').textContent = 'erro ao salvar (' + (bad[0] && bad[0].error || 'falhou') + ')'; return; }
      $('pg-status').textContent = '✅ página atualizada';
      $('pg-avatar').value = ''; $('pg-capa').value = '';
      api('settings').then(function (r) { return r.json(); }).then(function (j) { if (j.ok) { state.settings = j.settings; renderPagina(); } });
      setTimeout(function () { $('pg-status').textContent = ''; }, 3000);
    }).catch(function () { $('pg-save').disabled = false; $('pg-status').textContent = 'erro de conexão'; });
  }
  $('pg-save').addEventListener('click', savePagina);

  // ---------- Financeiro (DRE, imposto, recebíveis) ----------
  var fmtDayOnly = function (ts) { return new Date(ts).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }); };
  function dreRow(label, cents, neg, hint) {
    return '<div class="dre-row' + (neg ? ' neg' : '') + '"><div><div class="dl">' + esc(label) + '</div>' +
      (hint ? '<div class="sub">' + esc(hint) + '</div>' : '') + '</div><div class="dv">' + brl(cents) + '</div></div>';
  }
  function renderFinance() {
    var d = state.data; if (!d) return;
    var s = state.settings || {};
    var k = d.kpis;
    var taxPct = (typeof s.taxRatePct === 'number') ? s.taxRatePct : 6;
    var releaseDays = (typeof s.pixReleaseDays === 'number') ? s.pixReleaseDays : 1;
    var showTax = !(state.flags && state.flags.imposto === false);
    var gross = k.gross, net = k.net, fees = Math.max(0, gross - net), traffic = k.spend || 0;
    var tax = showTax ? Math.round(gross * taxPct / 100) : 0;
    var profit = net - traffic - tax;
    var margin = gross ? Math.round(profit / gross * 100) : 0;
    var body = $('dre-body');
    if (body) {
      body.innerHTML =
        dreRow('Faturamento bruto', gross, false, k.paidCount + ' venda(s) paga(s)') +
        dreRow('(−) Taxas do gateway', -fees, true, fees ? (gross ? (Math.round(fees / gross * 1000) / 10) + '% do bruto' : '') : 'sem dado (modo simulado)') +
        dreRow('(−) Tráfego pago', -traffic, true, traffic ? '' : 'nenhum gasto lançado') +
        (showTax ? dreRow('(−) Imposto estimado', -tax, true, taxPct + '% do bruto') : '') +
        '<div class="dre-row total"><div><div class="dl">= Lucro líquido</div><div class="sub">margem ' + margin + '%</div></div><div class="dv">' + brl(profit) + '</div></div>';
    }
    var recDays = $('rec-days'); if (recDays) recDays.textContent = releaseDays;
    renderRecebiveis(releaseDays);
  }
  function renderRecebiveis(releaseDays) {
    var body = $('recebiveis-body'); if (!body) return;
    var paid = (state.orders || []).filter(function (o) { return o.status === 'paid' && o.paidAt; });
    var now = Date.now(), DAY = 86400000, available = 0, pending = 0, upcoming = [];
    paid.forEach(function (o) {
      var releaseAt = o.paidAt + releaseDays * DAY;
      var amt = (o.netAmount != null ? o.netAmount : o.amount);
      if (releaseAt <= now) available += amt;
      else { pending += amt; upcoming.push({ at: releaseAt, amt: amt, label: o.label }); }
    });
    upcoming.sort(function (a, b) { return a.at - b.at; });
    var head = '<div class="fc-grid">' +
      '<div class="fc-box"><div class="l">Disponível</div><div class="v">' + brl(available) + '</div></div>' +
      '<div class="fc-box"><div class="l">A receber</div><div class="v">' + brl(pending) + '</div></div></div>';
    var list = upcoming.length
      ? tableHTML([{ t: 'Libera em' }, { t: 'Produto' }, { t: 'Valor', num: 1 }],
          upcoming.slice(0, 12).map(function (u) { return [fmtDayOnly(u.at), esc(u.label), brl(u.amt)]; }), '')
      : '<div class="sub" style="margin-top:6px">Tudo já liberado no período. 🎉</div>';
    body.innerHTML = head + list;
  }

  // ---------- IA & Insights (resumo, coach, previsão) ----------
  function periodLabel() { return state.days === 1 ? 'últimas 24h' : ('últimos ' + state.days + ' dias'); }
  function renderResumo() {
    var body = $('ia-resumo-body'); if (!body) return;
    var d = state.data; if (!d) { body.textContent = ''; return; }
    var k = d.kpis, p = d.prevKpis, parts = [];
    parts.push('Nos <b>' + periodLabel() + '</b> você faturou <b>' + brl(k.gross) + '</b> em <b>' + k.paidCount + '</b> venda(s)' +
      (k.pixCount ? ', com conversão de PIX de <b>' + k.pixConversion + '%</b>' : '') + '.');
    if (p && p.gross) {
      var pct = Math.round((k.gross - p.gross) / p.gross * 100);
      if (pct > 3) parts.push('Isso é <b>' + pct + '% a mais</b> que o período anterior — ritmo de alta. 📈');
      else if (pct < -3) parts.push('Isso é <b>' + Math.abs(pct) + '% a menos</b> que o período anterior — vale investigar. 📉');
      else parts.push('Praticamente estável frente ao período anterior.');
    }
    if (k.paidCount) parts.push('Ticket médio de <b>' + brl(k.ticket) + '</b>' +
      (d.avgPayMinutes ? ' e ~<b>' + d.avgPayMinutes + ' min</b> entre gerar o PIX e pagar' : '') + '.');
    var topSrc = (d.utm || []).filter(function (u) { return u.pago > 0; }).sort(function (a, b) { return b.revenue - a.revenue; })[0];
    if (topSrc) parts.push('Principal origem: <b>' + esc(topSrc.source) + '</b> (' + topSrc.pago + ' venda(s), ' + brl(topSrc.revenue) + ')' +
      (topSrc.spend ? ' com ROAS de <b>' + topSrc.roas + 'x</b>' : '') + '.');
    if (k.spend) parts.push('No geral, cada R$1 de anúncio trouxe <b>R$' + (k.roas || 0) + '</b>' + (k.roas >= 1 ? ' — no lucro. ✅' : ' — abaixo do ponto de equilíbrio. ⚠️') + '.');
    var topProd = (d.products || [])[0];
    if (topProd) parts.push('Carro-chefe: <b>' + esc(topProd.label) + '</b> (' + brl(topProd.revenue) + ').');
    body.innerHTML = parts.join(' ');
  }
  function bestHeat(heat) {
    if (!heat) return null;
    var best = null;
    for (var wd = 0; wd < 7; wd++) for (var h = 0; h < 24; h++) { var c = heat[wd][h]; if (c > 0 && (!best || c > best.c)) best = { wd: wd, h: h, c: c }; }
    return best;
  }
  function renderCoach() {
    var body = $('coach-body'); if (!body) return;
    var d = state.data; if (!d) { body.innerHTML = ''; return; }
    var k = d.kpis, items = [], ab = state.abandonedCount || 0;
    if (ab > 0) items.push({ tone: 'warn', icon: 'flame', w: 90 + ab, t: ab + ' PIX abandonado(s)', d: 'Chame no WhatsApp na aba “PIX abandonados” — é a recuperação mais barata que existe.' });
    if (k.pixCount >= 5 && k.pixConversion < 45) items.push({ tone: 'warn', icon: 'target', w: 80, t: 'Conversão de PIX baixa (' + k.pixConversion + '%)', d: 'Muita gente gera e não paga. Reforce urgência no checkout e o lembrete de pagamento.' });
    var badSrc = (d.utm || []).filter(function (u) { return u.spend > 0 && u.revenue < u.spend; }).sort(function (a, b) { return (a.revenue - a.spend) - (b.revenue - b.spend); })[0];
    if (badSrc) items.push({ tone: 'warn', icon: 'megaphone', w: 75, t: 'Origem no prejuízo: ' + badSrc.source, d: 'ROAS ' + badSrc.roas + 'x (gastou ' + brl(badSrc.spend) + ', voltou ' + brl(badSrc.revenue) + '). Revise o criativo ou pause.' });
    if (!d.goal || !d.goal.amount) items.push({ tone: '', icon: 'target', w: 60, t: 'Defina a meta do mês', d: 'Sem meta não há projeção. Configure em Metas & produtos.' });
    else if (d.goal.projection < d.goal.amount) items.push({ tone: 'warn', icon: 'target', w: 65, t: 'Projeção abaixo da meta', d: 'No ritmo atual você fecha ' + brl(d.goal.projection) + ' de ' + brl(d.goal.amount) + '. Acelere aquisição ou ticket.' });
    var best = bestHeat(d.heatmap);
    if (best) items.push({ tone: 'good', icon: 'flame', w: 40, t: 'Melhor horário: ' + WD[best.wd] + ' às ' + best.h + 'h', d: 'Foi quando mais vendeu. Programe posts e escale anúncio nesse horário.' });
    var goodSrc = (d.utm || []).filter(function (u) { return u.spend > 0 && u.roas >= 2; }).sort(function (a, b) { return b.roas - a.roas; })[0];
    if (goodSrc) items.push({ tone: 'good', icon: 'megaphone', w: 50, t: 'Escale ' + goodSrc.source, d: 'ROAS de ' + goodSrc.roas + 'x — está pagando bem. Aumente o orçamento com calma.' });
    if (!k.paidCount) items.push({ tone: '', icon: 'cart', w: 30, t: 'Sem vendas no período', d: 'Confira se página e checkout estão no ar e traga tráfego pra testar o funil.' });
    items.sort(function (a, b) { return b.w - a.w; });
    if (!items.length) { body.innerHTML = '<div class="empty">Tudo em ordem por aqui. 👌</div>'; return; }
    body.innerHTML = items.slice(0, 5).map(function (it) {
      return '<div class="coach-item ' + it.tone + '"><div class="ci-ic">' + svgIcon(it.icon) + '</div><div><div class="ci-t">' + esc(it.t) + '</div><div class="ci-d">' + esc(it.d) + '</div></div></div>';
    }).join('');
  }
  function renderForecast() {
    var body = $('forecast-body'); if (!body) return;
    var d = state.data; if (!d) { body.innerHTML = ''; return; }
    var g = d.goal || {}, daily = (d.daily || []).map(function (r) { return r.revenue || 0; });
    var html = '<div class="fc-grid">' +
      '<div class="fc-box"><div class="l">Projeção do mês</div><div class="v grad-text">' + brl(g.projection || 0) + '</div></div>' +
      '<div class="fc-box"><div class="l">Já faturado no mês</div><div class="v">' + brl(g.monthRevenue || 0) + '</div></div></div>';
    var total = daily.reduce(function (a, b) { return a + b; }, 0), avg = daily.length ? total / daily.length : 0;
    html += '<div class="sub" style="margin:4px 0 10px">Média de <b>' + brl(Math.round(avg)) + '</b>/dia no período · a projeção assume o ritmo atual até fechar o mês (' + (g.daysInMonth || 30) + ' dias).</div>';
    var variance = daily.length ? daily.reduce(function (a, b) { return a + Math.pow(b - avg, 2); }, 0) / daily.length : 0;
    var sd = Math.sqrt(variance), anomalies = [];
    if (sd > 0) (d.daily || []).forEach(function (r) { var z = (r.revenue - avg) / sd; if (Math.abs(z) >= 1.8) anomalies.push({ day: r.day, rev: r.revenue, up: z > 0 }); });
    var anHtml;
    if (!daily.length || sd === 0) anHtml = '<div class="sub">Dados insuficientes pra detectar anomalias.</div>';
    else if (!anomalies.length) anHtml = '<div class="anomaly" style="border-top:none"><span class="chip">estável</span> Nenhum dia fora da curva no período.</div>';
    else anHtml = anomalies.map(function (a) {
      return '<div class="anomaly"><span style="color:' + (a.up ? 'var(--good)' : 'var(--bad)') + ';font-weight:800">' + (a.up ? '▲' : '▼') + '</span> <b>' + a.day.slice(8) + '/' + a.day.slice(5, 7) + '</b> — ' + brl(a.rev) + (a.up ? ' (pico atípico)' : ' (queda atípica)') + '</div>';
    }).join('');
    body.innerHTML = html + '<div class="feat-cat" style="margin-top:4px">Dias fora da curva</div>' + anHtml;
  }

  // ---------- Insights de tráfego (mapa, criativos, funil por origem, antifraude, comparar) ----------
  var DDD_UF = { 11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP', 21: 'RJ', 22: 'RJ', 24: 'RJ', 27: 'ES', 28: 'ES', 31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG', 41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR', 47: 'SC', 48: 'SC', 49: 'SC', 51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS', 61: 'DF', 62: 'GO', 63: 'TO', 64: 'GO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO', 71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE', 81: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 86: 'PI', 87: 'PE', 88: 'CE', 89: 'PI', 91: 'PA', 92: 'AM', 93: 'PA', 94: 'PA', 95: 'RR', 96: 'AP', 97: 'AM', 98: 'MA', 99: 'MA' };
  function ufFromPhone(p) {
    p = String(p || '').replace(/\D/g, '');
    if (p.length >= 12 && p.slice(0, 2) === '55') p = p.slice(2);
    if (p.length < 10) return null;
    return DDD_UF[+p.slice(0, 2)] || null;
  }
  function renderMapa() {
    var box = $('mapa'); if (!box) return;
    var paid = (state.orders || []).filter(function (o) { return o.status === 'paid'; });
    var by = {};
    paid.forEach(function (o) { var uf = ufFromPhone(o.telefone) || '?'; by[uf] = by[uf] || { c: 0, rev: 0 }; by[uf].c++; by[uf].rev += o.amount; });
    var arr = Object.keys(by).map(function (uf) { return { uf: uf, c: by[uf].c, rev: by[uf].rev }; }).sort(function (a, b) { return b.rev - a.rev; });
    if (!arr.length) { box.innerHTML = '<div class="empty">Sem vendas com telefone no período.</div>'; return; }
    var max = Math.max.apply(null, arr.map(function (a) { return a.rev; }).concat([1]));
    box.innerHTML = arr.slice(0, 15).map(function (a) {
      return '<div class="fn-row"><div class="fn-label" style="width:52px;min-width:52px">' + esc(a.uf) + '</div>' +
        '<div class="fn-track"><div class="fn-bar" style="width:' + Math.round(a.rev / max * 100) + '%"></div></div>' +
        '<div class="fn-num">' + brl(a.rev) + ' <span class="pct">(' + a.c + ')</span></div></div>';
    }).join('');
  }
  function renderCriativos() {
    var box = $('criativos'); if (!box) return;
    var d = state.data; if (!d) return;
    var withSpend = (d.utm || []).filter(function (u) { return u.spend > 0; });
    var list = (withSpend.length ? withSpend : (d.utm || []).filter(function (u) { return u.pago > 0; })).slice();
    list.sort(function (a, b) { return (b.roas || 0) - (a.roas || 0) || b.revenue - a.revenue; });
    if (!list.length) { box.innerHTML = '<div class="empty">Marque campanhas com utm e lance gastos pra rankear.</div>'; return; }
    box.innerHTML = list.slice(0, 8).map(function (u) {
      var label = esc(u.source) + (u.campaign ? ' · ' + esc(u.campaign) : '');
      var badge = u.spend ? (u.roas >= 2 ? '<span class="roas-tag good">' + u.roas + 'x 🔥</span>' : (u.roas >= 1 ? '<span class="roas-tag good">' + u.roas + 'x</span>' : '<span class="roas-tag bad">' + u.roas + 'x ⚠️</span>')) : '<span class="sub">sem gasto</span>';
      return '<div class="rank-row"><div class="rk-main"><div class="rk-name">' + label + '</div>' +
        '<div class="rk-sub">' + u.pago + ' venda(s) · ' + brl(u.revenue) + (u.spend ? ' · gasto ' + brl(u.spend) : '') + (u.cpa ? ' · CPA ' + brl(u.cpa) : '') + '</div></div>' +
        '<div class="rk-pts">' + badge + '</div></div>';
    }).join('');
  }
  function renderFunilOrigem() {
    var box = $('funil-origem'); if (!box) return;
    var d = state.data; if (!d) return;
    var srcs = (d.utm || []).filter(function (u) { return (u.landingViews || u.views || 0) > 0; })
      .sort(function (a, b) { return (b.landingViews || b.views) - (a.landingViews || a.views); }).slice(0, 5);
    if (!srcs.length) { box.innerHTML = '<div class="empty">Sem tráfego com origem no período.</div>'; return; }
    box.innerHTML = srcs.map(function (u) {
      var steps = [{ l: 'Visitas', v: u.landingViews || 0 }, { l: 'Checkout', v: u.checkoutViews || 0 }, { l: 'PIX', v: u.pix || 0 }, { l: 'Pago', v: u.pago || 0 }];
      var base = steps[0].v || 1;
      var chips = steps.map(function (s, i) {
        return '<div class="fo-step"><div class="fo-v">' + s.v + '</div><div class="fo-l">' + s.l + '</div><div class="fo-p">' + (i === 0 ? 100 : Math.round(s.v / base * 100)) + '%</div></div>';
      }).join('<div class="fo-arrow">›</div>');
      return '<div class="fo-block"><div class="fo-src">' + esc(u.source) + (u.campaign ? ' · ' + esc(u.campaign) : '') + '</div><div class="fo-row">' + chips + '</div></div>';
    }).join('');
  }
  function renderAntifraude() {
    var box = $('antifraude'); if (!box) return;
    var by = {};
    (state.orders || []).forEach(function (o) {
      var key = (o.email || '').toLowerCase() || String(o.telefone || '').replace(/\D/g, '');
      if (!key) return;
      by[key] = by[key] || { name: o.nome, email: o.email, telefone: o.telefone, total: 0, paid: 0, pend: 0 };
      by[key].total++; if (o.status === 'paid') by[key].paid++; else by[key].pend++;
    });
    var flagged = Object.keys(by).map(function (k) { return by[k]; }).filter(function (x) { return x.total >= 3; }).sort(function (a, b) { return b.total - a.total; });
    if (!flagged.length) { box.innerHTML = '<div class="empty">Nenhum padrão suspeito no período. ✅</div>'; return; }
    box.innerHTML = tableHTML(
      [{ t: 'Cliente' }, { t: 'Pedidos', num: 1 }, { t: 'Pagos', num: 1 }, { t: 'Pendentes', num: 1 }],
      flagged.slice(0, 20).map(function (x) {
        return [esc(x.name) + '<div class="sub">' + esc(maskEmail(x.email)) + ' · ' + esc(maskPhone(x.telefone)) + '</div>', x.total, x.paid, (x.pend >= 3 ? '<span class="roas-tag bad">' + x.pend + '</span>' : x.pend)];
      }), '');
  }
  function deltaCompare(curr, prev) {
    if (!prev) return curr ? '<span class="roas-tag good">novo</span>' : '<span class="sub">—</span>';
    var pct = Math.round((curr - prev) / prev * 100);
    if (pct === 0) return '<span class="sub">0%</span>';
    return '<span class="roas-tag ' + (pct > 0 ? 'good' : 'bad') + '">' + (pct > 0 ? '▲' : '▼') + ' ' + Math.abs(pct) + '%</span>';
  }
  function renderComparar() {
    var box = $('comparar'); if (!box) return;
    var d = state.data; if (!d) return;
    var k = d.kpis, p = d.prevKpis;
    var rows = [
      { l: 'Faturamento', c: k.gross, pv: p.gross, money: true },
      { l: 'Líquido', c: k.net, pv: p.net, money: true },
      { l: 'Vendas pagas', c: k.paidCount, pv: p.paidCount },
      { l: 'Conversão PIX (%)', c: k.pixConversion, pv: p.pixConversion },
      { l: 'Ticket médio', c: k.ticket, pv: p.ticket, money: true },
      { l: 'Visitas', c: k.visits, pv: p.visits },
      { l: 'ROAS', c: k.roas, pv: p.roas, x: true },
    ];
    box.innerHTML = tableHTML(
      [{ t: 'Métrica' }, { t: 'Anterior', num: 1 }, { t: 'Agora', num: 1 }, { t: 'Variação', num: 1 }],
      rows.map(function (r) {
        var fmt = function (v) { return r.money ? brl(v) : (r.x ? (v ? v + 'x' : '—') : String(v)); };
        return [r.l, fmt(r.pv), '<b>' + fmt(r.c) + '</b>', deltaCompare(r.c, r.pv)];
      }), '');
  }

  function renderComputed() {
    if (!state.data) return;
    try { renderFinance(); } catch (e) { /* */ }
    try { renderResumo(); renderCoach(); renderForecast(); } catch (e) { /* */ }
    try { renderMapa(); renderCriativos(); renderFunilOrigem(); renderAntifraude(); renderComparar(); } catch (e) { /* */ }
    try { renderABReport(); renderMapaVui(); } catch (e) { /* */ }
  }

  // ---------- Membros (MRR, gamificação, coorte, níveis VIP) ----------
  function memberTier(m) {
    var s = m.totalSpent;
    if (s >= 30000) return 'diamante';
    if (s >= 15000) return 'ouro';
    if (s >= 6000) return 'prata';
    return 'bronze';
  }
  function memberPoints(m) { return m.purchases * 100 + m.tenureMonths * 50; }
  function renderMrr() {
    var st = state.membersData && state.membersData.stats; var box = $('sec-mrr'); if (!box) return;
    if (!st) { box.innerHTML = ''; return; }
    var cards = [
      { l: 'MRR (recorrência)', v: brl(st.mrr) }, { l: 'Membros ativos', v: String(st.active) },
      { l: 'Vencendo em 7d', v: String(st.expiring7) }, { l: 'ARPU', v: brl(st.arpu) },
      { l: 'Recompradores', v: String(st.repeat) }, { l: 'ARR (proj. 12m)', v: brl(st.arr) },
    ];
    box.innerHTML = cards.map(function (c) { return '<div class="mini"><div class="l">' + c.l + '</div><div class="v">' + c.v + '</div></div>'; }).join('');
  }
  function renderMembersTable() {
    var data = state.membersData; if (!data) return;
    var q = (state.memQuery || '').toLowerCase(), f = state.memFilter || '';
    var rows = data.members.filter(function (m) {
      if (f === 'active' && !m.active) return false;
      if (f === 'expired' && m.active) return false;
      if (f === 'expiring' && !(m.active && m.daysLeft <= 7)) return false;
      if (q && (m.name + ' ' + m.email).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).slice(0, 200);
    $('members').innerHTML = tableHTML(
      [{ t: 'Membro' }, { t: 'Plano' }, { t: 'Status' }, { t: 'Compras', num: 1 }, { t: 'Total', num: 1 }],
      rows.map(function (m) {
        var status = m.active
          ? (m.daysLeft <= 7 ? '<span class="pill pending"><span class="pd"></span>vence em ' + m.daysLeft + 'd</span>' : '<span class="pill paid"><span class="pd"></span>ativo · ' + m.daysLeft + 'd</span>')
          : '<span class="pill" style="background:rgba(255,93,143,.12);color:var(--bad)"><span class="pd"></span>expirado</span>';
        return [esc(m.name) + '<div class="sub">' + esc(maskEmail(m.email)) + '</div>', esc(m.label || m.plan), status, m.purchases, brl(m.totalSpent)];
      }),
      'Nenhum membro ainda.'
    );
  }
  function renderGamificacao() {
    var data = state.membersData; if (!data) return;
    var ranked = data.members.map(function (m) { return { m: m, pts: memberPoints(m) }; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, 10);
    if (!ranked.length) { $('gamificacao').innerHTML = '<div class="empty">Sem membros ainda.</div>'; return; }
    $('gamificacao').innerHTML = ranked.map(function (r, i) {
      var m = r.m, tier = memberTier(m);
      return '<div class="rank-row"><div class="rank-n">' + (i + 1) + '</div>' +
        '<div class="rk-main"><div class="rk-name">' + esc(m.name) + ' <span class="tier ' + tier + '">' + tier + '</span></div>' +
        '<div class="rk-sub">' + m.purchases + ' compra(s) · ' + m.tenureMonths + ' mês(es) · ' + brl(m.totalSpent) + '</div></div>' +
        '<div class="rk-pts">' + r.pts + ' pts</div></div>';
    }).join('');
  }
  function renderCoorte() {
    var data = state.membersData; if (!data) return;
    $('coorte').innerHTML = tableHTML(
      [{ t: 'Mês de entrada' }, { t: 'Entraram', num: 1 }, { t: 'Ativos', num: 1 }, { t: 'Retenção', num: 1 }],
      data.cohort.map(function (c) {
        return [c.cohort, c.size, c.retained, '<span class="roas-tag ' + (c.retentionPct >= 50 ? 'good' : 'bad') + '">' + c.retentionPct + '%</span>'];
      }),
      'Sem dados de coorte ainda.'
    );
  }
  function loadMembers() {
    api('members').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      state.membersData = j;
      if ($('nav-members')) $('nav-members').textContent = j.stats.active;
      renderMrr(); renderMembersTable(); renderGamificacao(); renderCoorte();
      if (state.view === 'remarketing') renderRemList();
    }).catch(function () {});
  }
  // Níveis VIP (editor)
  function collectNiveis() {
    return [].slice.call(document.querySelectorAll('#niveis-list .niv-row')).map(function (row) {
      return { name: row.querySelector('.niv-name').value, price: Math.round(parseFloat(row.querySelector('.niv-price').value || '0') * 100), link: row.querySelector('.niv-link').value };
    });
  }
  function nivRow(lv) {
    return '<div class="niv-row">' +
      '<input class="niv-name" value="' + esc(lv.name || '') + '" placeholder="Nome">' +
      '<input class="niv-price" type="number" step="0.01" value="' + ((lv.price || 0) / 100).toFixed(2) + '" placeholder="Preço">' +
      '<input class="niv-link" value="' + esc(lv.link || '') + '" placeholder="https://t.me/+...">' +
      '<button class="niv-del" title="Remover">×</button></div>';
  }
  function renderNiveis() {
    var s = state.settings; if (!s || !$('niveis-list')) return;
    var levels = s.vipLevels || [];
    $('niveis-list').innerHTML = levels.length ? levels.map(nivRow).join('') : '<div class="sub">Nenhum nível. Adicione um.</div>';
  }
  if ($('niveis-add')) $('niveis-add').addEventListener('click', function () {
    var lv = collectNiveis(); lv.push({ name: '', price: 0, link: '' }); state.settings.vipLevels = lv; renderNiveis();
  });
  if ($('niveis-list')) $('niveis-list').addEventListener('click', function (e) {
    var del = e.target.closest('.niv-del'); if (!del) return;
    var rows = [].slice.call(document.querySelectorAll('#niveis-list .niv-row'));
    var i = rows.indexOf(del.closest('.niv-row'));
    var lv = collectNiveis(); lv.splice(i, 1); state.settings.vipLevels = lv; renderNiveis();
  });
  if ($('niveis-save')) $('niveis-save').addEventListener('click', function () {
    var levels = collectNiveis();
    $('niveis-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vipLevels: levels }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) { state.settings = j.settings; renderNiveis(); $('niveis-status').textContent = '✅ salvo'; setTimeout(function () { $('niveis-status').textContent = ''; }, 2500); }
        else $('niveis-status').textContent = 'erro';
      }).catch(function () { $('niveis-status').textContent = 'erro'; });
  });
  if ($('mem-search')) $('mem-search').addEventListener('input', function (e) { state.memQuery = e.target.value; renderMembersTable(); });
  if ($('mem-filter')) $('mem-filter').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('mem-filter').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.memFilter = b.dataset.f; renderMembersTable();
  });

  // ---------- Crescimento (UTM, público Meta, prova social, depoimentos, afiliados, indicação) ----------
  function siteOrigin() { return window.location.origin; }
  function copyText(txt, statusEl) {
    try { navigator.clipboard.writeText(txt); if (statusEl) { statusEl.textContent = 'copiado ✓'; setTimeout(function () { statusEl.textContent = ''; }, 2000); } }
    catch (e) { if (statusEl) statusEl.textContent = 'copie manualmente'; }
  }
  function buildUtm() {
    var base = ($('utm-base') && $('utm-base').value.trim()) || siteOrigin() + '/';
    var qs = [];
    [['utm_source', 'utm-source'], ['utm_medium', 'utm-medium'], ['utm_campaign', 'utm-campaign'], ['utm_content', 'utm-content']].forEach(function (pair) {
      var v = $(pair[1]) && $(pair[1]).value.trim();
      if (v) qs.push(pair[0] + '=' + encodeURIComponent(v));
    });
    var url = base + (qs.length ? (base.indexOf('?') >= 0 ? '&' : '?') + qs.join('&') : '');
    if ($('utm-out')) $('utm-out').textContent = url;
    return url;
  }
  ['utm-base', 'utm-source', 'utm-medium', 'utm-campaign', 'utm-content'].forEach(function (id) { if ($(id)) $(id).addEventListener('input', buildUtm); });
  if ($('utm-copy')) $('utm-copy').addEventListener('click', function () { copyText(buildUtm(), $('utm-status')); });
  if ($('pm-download')) $('pm-download').addEventListener('click', function () {
    api('audience.csv').then(function (r) { return r.blob(); }).then(function (blob) {
      var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'publico-meta.csv'; a.click(); URL.revokeObjectURL(a.href);
    });
  });
  function loadPulse() {
    var box = $('prova-preview'); if (!box) return;
    fetch('/api/pulse').then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      if (j.enabled === false) { box.innerHTML = '<div class="fc-box"><div class="l">Status na landing</div><div class="v" style="font-size:15px">desligado</div></div>'; return; }
      box.innerHTML = '<div class="fc-box"><div class="l">Compras (24h)</div><div class="v">' + j.today + '</div></div>' +
        '<div class="fc-box"><div class="l">Na última hora</div><div class="v">' + j.lastHour + '</div></div>';
    }).catch(function () {});
  }
  // Depoimentos
  function collectDep() {
    return [].slice.call(document.querySelectorAll('#dep-list .dep-row')).map(function (row) {
      return { name: row.querySelector('.dep-name').value, uf: row.querySelector('.dep-uf').value, rating: +row.querySelector('.dep-rating').value || 5, text: row.querySelector('.dep-text').value };
    });
  }
  function depRow(t) {
    return '<div class="dep-row" style="border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:8px">' +
      '<div class="niv-row" style="margin-bottom:6px"><input class="dep-name" style="width:150px" value="' + esc(t.name || '') + '" placeholder="Nome"><input class="dep-uf" style="width:60px" value="' + esc(t.uf || '') + '" placeholder="UF"><select class="dep-rating">' +
      [5, 4, 3, 2, 1].map(function (n) { return '<option value="' + n + '"' + (((t.rating || 5) === n) ? ' selected' : '') + '>' + n + '★</option>'; }).join('') + '</select><button class="niv-del dep-del" title="Remover">×</button></div>' +
      '<textarea class="dep-text set-in" style="margin:0" placeholder="Depoimento...">' + esc(t.text || '') + '</textarea></div>';
  }
  function renderDep() {
    var s = state.settings; if (!s || !$('dep-list')) return;
    var list = s.testimonials || [];
    $('dep-list').innerHTML = list.length ? list.map(depRow).join('') : '<div class="sub">Nenhum depoimento. Adicione um.</div>';
  }
  if ($('dep-add')) $('dep-add').addEventListener('click', function () { var l = collectDep(); l.push({ name: '', uf: '', rating: 5, text: '' }); state.settings.testimonials = l; renderDep(); });
  if ($('dep-list')) $('dep-list').addEventListener('click', function (e) { var d = e.target.closest('.dep-del'); if (!d) return; var rows = [].slice.call(document.querySelectorAll('#dep-list .dep-row')); var i = rows.indexOf(d.closest('.dep-row')); var l = collectDep(); l.splice(i, 1); state.settings.testimonials = l; renderDep(); });
  if ($('dep-save')) $('dep-save').addEventListener('click', function () {
    $('dep-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testimonials: collectDep() }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderDep(); $('dep-status').textContent = '✅ salvo'; setTimeout(function () { $('dep-status').textContent = ''; }, 2500); } else $('dep-status').textContent = 'erro';
    }).catch(function () { $('dep-status').textContent = 'erro'; });
  });
  // Afiliados
  function collectAff() {
    return [].slice.call(document.querySelectorAll('#aff-list .aff-row')).map(function (row) {
      return { name: row.querySelector('.aff-name').value, code: row.querySelector('.aff-code').value, commissionPct: parseFloat(row.querySelector('.aff-pct').value) || 0 };
    });
  }
  function affRow(a) {
    var link = siteOrigin() + '/?ref=' + encodeURIComponent((a.code || '').toLowerCase().replace(/[^a-z0-9-]/g, ''));
    return '<div class="aff-row" style="margin-bottom:8px">' +
      '<div class="niv-row" style="margin-bottom:4px"><input class="aff-name" style="width:140px" value="' + esc(a.name || '') + '" placeholder="Nome"><input class="aff-code" style="width:110px" value="' + esc(a.code || '') + '" placeholder="codigo"><input class="aff-pct niv-price" type="number" step="1" value="' + (a.commissionPct || 0) + '" placeholder="%"><button class="niv-del aff-del" title="Remover">×</button></div>' +
      '<div class="sub" style="word-break:break-all">' + esc(link) + ' <span class="reveal aff-copy" data-link="' + esc(link) + '">copiar</span></div></div>';
  }
  function renderAffList() {
    var s = state.settings; if (!s || !$('aff-list')) return;
    var list = s.affiliates || [];
    $('aff-list').innerHTML = list.length ? list.map(affRow).join('') : '<div class="sub">Nenhum afiliado. Adicione um.</div>';
  }
  function renderAffLedger() {
    var d = state.affData; if (!d || !$('aff-ledger')) return;
    if ($('aff-totals')) $('aff-totals').innerHTML =
      '<div class="mini"><div class="l">Vendas por afiliados</div><div class="v">' + d.totals.sales + '</div></div>' +
      '<div class="mini"><div class="l">Receita atribuída</div><div class="v">' + brl(d.totals.revenue) + '</div></div>' +
      '<div class="mini"><div class="l">Comissão a pagar</div><div class="v">' + brl(d.totals.commission) + '</div></div>';
    $('aff-ledger').innerHTML = tableHTML(
      [{ t: 'Afiliado' }, { t: 'Código' }, { t: 'Vendas', num: 1 }, { t: 'Receita', num: 1 }, { t: 'Comissão', num: 1 }],
      d.affiliates.map(function (a) { return [esc(a.name) + (a.registered ? '' : ' <span class="badge-soon">não cadastrado</span>'), esc(a.code), a.sales, brl(a.revenue), a.commissionPct ? brl(a.commission) + ' <span class="sub">(' + a.commissionPct + '%)</span>' : '<span class="sub">—</span>']; }),
      'Nenhuma venda por afiliado ainda.'
    );
  }
  function loadAffiliates() {
    api('affiliates?window=90').then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) return; state.affData = j; renderAffLedger(); }).catch(function () {});
  }
  if ($('aff-add')) $('aff-add').addEventListener('click', function () { var l = collectAff(); l.push({ name: '', code: '', commissionPct: 0 }); state.settings.affiliates = l; renderAffList(); });
  if ($('aff-list')) $('aff-list').addEventListener('click', function (e) {
    var cp = e.target.closest('.aff-copy'); if (cp) { copyText(cp.dataset.link, null); cp.textContent = 'copiado ✓'; return; }
    var d = e.target.closest('.aff-del'); if (!d) return;
    var rows = [].slice.call(document.querySelectorAll('#aff-list .aff-row')); var i = rows.indexOf(d.closest('.aff-row')); var l = collectAff(); l.splice(i, 1); state.settings.affiliates = l; renderAffList();
  });
  if ($('aff-save')) $('aff-save').addEventListener('click', function () {
    $('aff-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ affiliates: collectAff() }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderAffList(); $('aff-status').textContent = '✅ salvo'; setTimeout(function () { $('aff-status').textContent = ''; }, 2500); } else $('aff-status').textContent = 'erro';
    }).catch(function () { $('aff-status').textContent = 'erro'; });
  });
  // Embaixadores (indicação)
  function buildEmb() {
    var code = ($('emb-code') && $('emb-code').value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16)) || '';
    var link = code ? siteOrigin() + '/?ref=' + code : '—';
    if ($('emb-out')) $('emb-out').textContent = link;
    return link;
  }
  if ($('emb-code')) $('emb-code').addEventListener('input', buildEmb);
  if ($('emb-copy')) $('emb-copy').addEventListener('click', function () { var l = buildEmb(); if (l && l !== '—') copyText(l, $('emb-status')); });
  function renderCrescimento() { buildUtm(); renderDep(); renderAffList(); buildEmb(); loadPulse(); loadAffiliates(); }

  // ---------- Ofertas (cupons + order bump) ----------
  function cupomRow(c) {
    return '<div class="niv-row cupom-row" data-uses="' + (c.uses || 0) + '" style="flex-wrap:wrap">' +
      '<input class="cp-code" style="width:120px;text-transform:uppercase" value="' + esc(c.code || '') + '" placeholder="CODIGO">' +
      '<select class="cp-type"><option value="pct"' + (c.type !== 'fixed' ? ' selected' : '') + '>%</option><option value="fixed"' + (c.type === 'fixed' ? ' selected' : '') + '>R$</option></select>' +
      '<input class="cp-value niv-price" type="number" step="0.01" value="' + (c.type === 'fixed' ? ((c.value || 0) / 100).toFixed(2) : (c.value || 0)) + '" placeholder="valor">' +
      '<input class="cp-max niv-price" type="number" step="1" value="' + (c.maxUses || 0) + '" title="usos máximos (0 = ilimitado)" style="width:74px">' +
      '<label class="sub" style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="cp-active"' + (c.active !== false ? ' checked' : '') + '> ativo</label>' +
      '<span class="sub">' + (c.uses || 0) + ' uso(s)</span>' +
      '<button class="niv-del cp-del" title="Remover">×</button></div>';
  }
  function collectCupons() {
    return [].slice.call(document.querySelectorAll('#cupons-list .cupom-row')).map(function (row) {
      var type = row.querySelector('.cp-type').value;
      var raw = parseFloat(row.querySelector('.cp-value').value) || 0;
      return {
        code: row.querySelector('.cp-code').value,
        type: type,
        value: type === 'fixed' ? Math.round(raw * 100) : Math.round(raw),
        maxUses: parseInt(row.querySelector('.cp-max').value, 10) || 0,
        active: row.querySelector('.cp-active').checked,
        uses: +(row.getAttribute('data-uses') || 0),
      };
    });
  }
  function renderCupons() {
    var s = state.settings; if (!s || !$('cupons-list')) return;
    var list = s.coupons || [];
    $('cupons-list').innerHTML = list.length ? list.map(cupomRow).join('') : '<div class="sub">Nenhum cupom. Adicione um.</div>';
  }
  if ($('cupom-add')) $('cupom-add').addEventListener('click', function () { var l = collectCupons(); l.push({ code: '', type: 'pct', value: 10, maxUses: 0, active: true, uses: 0 }); state.settings.coupons = l; renderCupons(); });
  if ($('cupons-list')) $('cupons-list').addEventListener('click', function (e) {
    var d = e.target.closest('.cp-del'); if (!d) return;
    var rows = [].slice.call(document.querySelectorAll('#cupons-list .cupom-row')); var i = rows.indexOf(d.closest('.cupom-row'));
    var l = collectCupons(); l.splice(i, 1); state.settings.coupons = l; renderCupons();
  });
  if ($('cupom-save')) $('cupom-save').addEventListener('click', function () {
    $('cupom-status2').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coupons: collectCupons() }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderCupons(); $('cupom-status2').textContent = '✅ salvo'; setTimeout(function () { $('cupom-status2').textContent = ''; }, 2500); } else $('cupom-status2').textContent = 'erro';
    }).catch(function () { $('cupom-status2').textContent = 'erro'; });
  });
  function renderOrderBump() {
    var s = state.settings; if (!s || !$('ob-enabled')) return;
    var ob = s.orderBump || {};
    $('ob-enabled').checked = !!ob.enabled;
    $('ob-label').value = ob.label || '';
    $('ob-desc').value = ob.desc || '';
    $('ob-price').value = ((ob.price || 0) / 100).toFixed(2);
  }
  if ($('ob-save')) $('ob-save').addEventListener('click', function () {
    var ob = { enabled: $('ob-enabled').checked, label: $('ob-label').value, desc: $('ob-desc').value, price: Math.round(parseFloat($('ob-price').value || '0') * 100) };
    $('ob-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderBump: ob }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderOrderBump(); $('ob-status').textContent = '✅ salvo'; setTimeout(function () { $('ob-status').textContent = ''; }, 2500); } else $('ob-status').textContent = 'erro';
    }).catch(function () { $('ob-status').textContent = 'erro'; });
  });
  // Quiz de qualificação
  function qzOptRow(o) {
    return '<div class="niv-row qz-opt-row"><input class="qz-label" style="flex:1;min-width:120px" value="' + esc(o.label || '') + '" placeholder="Rótulo (ex: Fotos)"><input class="qz-tag" style="width:120px" value="' + esc(o.tag || '') + '" placeholder="tag"><button class="niv-del qz-del" title="Remover">×</button></div>';
  }
  function collectQuizOptions() {
    return [].slice.call(document.querySelectorAll('#qz-options .qz-opt-row')).map(function (row) {
      return { label: row.querySelector('.qz-label').value, tag: row.querySelector('.qz-tag').value };
    });
  }
  function renderQuizCfg() {
    var s = state.settings; if (!s || !$('qz-enabled')) return;
    var q = s.quiz || {};
    $('qz-enabled').checked = !!q.enabled;
    $('qz-question').value = q.question || '';
    $('qz-options').innerHTML = (q.options || []).length ? q.options.map(qzOptRow).join('') : '<div class="sub">Nenhuma opção. Adicione.</div>';
  }
  if ($('qz-add')) $('qz-add').addEventListener('click', function () {
    var s = state.settings; s.quiz = s.quiz || { options: [] }; s.quiz.options = collectQuizOptions(); s.quiz.options.push({ label: '', tag: '' }); renderQuizCfg();
  });
  if ($('qz-options')) $('qz-options').addEventListener('click', function (e) {
    var d = e.target.closest('.qz-del'); if (!d) return;
    var rows = [].slice.call(document.querySelectorAll('#qz-options .qz-opt-row')); var i = rows.indexOf(d.closest('.qz-opt-row'));
    var opts = collectQuizOptions(); opts.splice(i, 1); state.settings.quiz = state.settings.quiz || {}; state.settings.quiz.options = opts; renderQuizCfg();
  });
  if ($('qz-save')) $('qz-save').addEventListener('click', function () {
    var quiz = { enabled: $('qz-enabled').checked, question: $('qz-question').value, options: collectQuizOptions() };
    $('qz-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quiz: quiz }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderQuizCfg(); $('qz-status').textContent = '✅ salvo'; setTimeout(function () { $('qz-status').textContent = ''; }, 2500); } else $('qz-status').textContent = 'erro';
    }).catch(function () { $('qz-status').textContent = 'erro'; });
  });
  // Teste A/B de preço (config + relatório)
  function renderABReport() {
    if (!$('ab-report')) return;
    var by = { A: { n: 0, paid: 0, rev: 0 }, B: { n: 0, paid: 0, rev: 0 } };
    (state.orders || []).forEach(function (o) {
      var v = o.abVariant === 'B' ? 'B' : (o.abVariant === 'A' ? 'A' : null); if (!v) return;
      by[v].n++; if (o.status === 'paid') { by[v].paid++; by[v].rev += o.amount; }
    });
    if (!by.A.n && !by.B.n) { $('ab-report').innerHTML = '<div class="sub">Sem dados A/B ainda (ative o teste e traga tráfego).</div>'; return; }
    var convA = by.A.n ? by.A.paid / by.A.n : 0, convB = by.B.n ? by.B.paid / by.B.n : 0;
    var winner = (by.A.n && by.B.n) ? (convA >= convB ? 'A' : 'B') : '';
    $('ab-report').innerHTML = tableHTML(
      [{ t: 'Variante' }, { t: 'PIX gerados', num: 1 }, { t: 'Pagos', num: 1 }, { t: 'Conversão', num: 1 }, { t: 'Receita', num: 1 }],
      ['A', 'B'].map(function (v) {
        var d = by[v], conv = d.n ? Math.round(d.paid / d.n * 100) : 0;
        return ['Preço ' + v + (winner === v ? ' 🏆' : ''), d.n, d.paid, '<span class="roas-tag ' + (winner === v ? 'good' : 'bad') + '">' + conv + '%</span>', brl(d.rev)];
      }), '');
  }
  function renderABTest() {
    var s = state.settings; if (!s || !$('ab-enabled')) return;
    var ab = s.abTest || {};
    $('ab-enabled').checked = !!ab.enabled;
    $('ab-plan').value = ab.plan || 'mensal';
    $('ab-priceb').value = ((ab.priceB || 0) / 100).toFixed(2);
    renderABReport();
  }
  if ($('ab-save')) $('ab-save').addEventListener('click', function () {
    var ab = { enabled: $('ab-enabled').checked, plan: $('ab-plan').value, priceB: Math.round(parseFloat($('ab-priceb').value || '0') * 100) };
    $('ab-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ abTest: ab }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderABTest(); $('ab-status').textContent = '✅ salvo'; setTimeout(function () { $('ab-status').textContent = ''; }, 2500); } else $('ab-status').textContent = 'erro';
    }).catch(function () { $('ab-status').textContent = 'erro'; });
  });
  function renderOfertas() { renderCupons(); renderOrderBump(); renderQuizCfg(); renderABTest(); }

  // ---------- Config & segurança (auto-logout, modo TV, PDF, webhooks, backup) ----------
  var idleTimer = null;
  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (state.flags && state.flags.auto_logout) idleTimer = setTimeout(function () { logout(); }, 30 * 60 * 1000);
  }
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(function (ev) { document.addEventListener(ev, resetIdle, { passive: true }); });

  // Modo TV
  var tvTimer = null, tvIdx = 0;
  function tvSlides() {
    var d = state.data; if (!d) return [];
    var k = d.kpis, g = d.goal || {};
    return [
      { label: 'Faturamento (período)', value: brl(k.gross), sub: k.paidCount + ' vendas · ticket ' + brl(k.ticket) },
      { label: 'Vendas pagas', value: String(k.paidCount), sub: 'conversão PIX ' + k.pixConversion + '%' },
      { label: 'Faturamento do mês', value: brl(g.monthRevenue || 0), sub: 'meta ' + brl(g.amount || 0) + ' · projeção ' + brl(g.projection || 0) },
      { label: 'Lucro (pós-gasto)', value: brl(k.profit), sub: k.spend ? 'ROAS ' + k.roas + 'x' : 'sem gasto lançado' },
      { label: 'Visitas (período)', value: String(k.visits), sub: k.uniques + ' visitantes únicos' },
    ];
  }
  function tvRender() {
    var slides = tvSlides(); if (!slides.length) return;
    tvIdx = tvIdx % slides.length; var s = slides[tvIdx];
    $('tv-label').textContent = s.label; $('tv-value').textContent = s.value; $('tv-sub').textContent = s.sub;
    $('tv-dots').innerHTML = slides.map(function (_, i) { return '<i class="' + (i === tvIdx ? 'on' : '') + '"></i>'; }).join('');
  }
  function enterTv() {
    if (!state.data) return;
    $('tv-mode').classList.add('on'); tvIdx = 0; tvRender();
    if (tvTimer) clearInterval(tvTimer);
    tvTimer = setInterval(function () { tvIdx++; tvRender(); }, 5000);
    try { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); } catch (e) { /* */ }
  }
  function exitTv() {
    $('tv-mode').classList.remove('on');
    if (tvTimer) clearInterval(tvTimer);
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* */ }
  }
  if ($('btn-tv')) $('btn-tv').addEventListener('click', enterTv);
  if ($('tv-exit')) $('tv-exit').addEventListener('click', exitTv);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('tv-mode').classList.contains('on')) exitTv(); });

  // Relatório PDF (via impressão)
  function buildReport() {
    var d = state.data; if (!d) return;
    var k = d.kpis;
    var kpis = [['Faturamento bruto', brl(k.gross)], ['Líquido', brl(k.net)], ['Vendas pagas', String(k.paidCount)], ['Ticket médio', brl(k.ticket)], ['Conversão PIX', k.pixConversion + '%'], ['Visitas', String(k.visits)], ['Lucro (pós-gasto)', brl(k.profit)], ['ROAS', k.roas ? k.roas + 'x' : '—']];
    var prods = (d.products || []).slice(0, 10).map(function (p) { return '<tr><td>' + esc(p.label) + '</td><td>' + p.paid + '</td><td>' + brl(p.revenue) + '</td></tr>'; }).join('');
    var utm = (d.utm || []).slice(0, 10).map(function (u) { return '<tr><td>' + esc(u.source) + '</td><td>' + u.pago + '</td><td>' + brl(u.revenue) + '</td><td>' + (u.spend ? u.roas + 'x' : '—') + '</td></tr>'; }).join('');
    var now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    $('print-report').innerHTML =
      '<h1>Relatório Agatha VIP</h1><div>Período: últimos ' + state.days + ' dia(s) · gerado em ' + now + '</div>' +
      '<h2>Resumo</h2><div class="pr-kpis">' + kpis.map(function (x) { return '<div class="pr-kpi">' + x[0] + '<b>' + x[1] + '</b></div>'; }).join('') + '</div>' +
      '<h2>Vendas por produto</h2><table><thead><tr><th>Produto</th><th>Vendas</th><th>Receita</th></tr></thead><tbody>' + (prods || '<tr><td colspan="3">Sem vendas</td></tr>') + '</tbody></table>' +
      '<h2>Origens de tráfego</h2><table><thead><tr><th>Origem</th><th>Vendas</th><th>Receita</th><th>ROAS</th></tr></thead><tbody>' + (utm || '<tr><td colspan="4">Sem tráfego</td></tr>') + '</tbody></table>';
  }
  if ($('btn-pdf')) $('btn-pdf').addEventListener('click', function () { buildReport(); setTimeout(function () { window.print(); }, 120); });

  // Webhooks
  function whRow(w) {
    return '<div class="niv-row wh-row"><input class="wh-url" style="flex:1;min-width:160px" value="' + esc(w.url || '') + '" placeholder="https://...">' +
      '<label class="sub" style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="wh-active"' + (w.active !== false ? ' checked' : '') + '> ativo</label>' +
      '<span class="reveal wh-test">testar</span><button class="niv-del wh-del" title="Remover">×</button></div>';
  }
  function collectWebhooks() {
    return [].slice.call(document.querySelectorAll('#wh-list .wh-row')).map(function (row) { return { url: row.querySelector('.wh-url').value, active: row.querySelector('.wh-active').checked }; });
  }
  function renderWebhooks() {
    var s = state.settings; if (!s || !$('wh-list')) return;
    var list = s.webhooks || [];
    $('wh-list').innerHTML = list.length ? list.map(whRow).join('') : '<div class="sub">Nenhum webhook. Adicione um.</div>';
  }
  if ($('wh-add')) $('wh-add').addEventListener('click', function () { var l = collectWebhooks(); l.push({ url: '', active: true }); state.settings.webhooks = l; renderWebhooks(); });
  if ($('wh-list')) $('wh-list').addEventListener('click', function (e) {
    var test = e.target.closest('.wh-test');
    if (test) {
      var url = test.closest('.wh-row').querySelector('.wh-url').value; test.textContent = '…';
      api('webhook-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) }).then(function (r) { return r.json(); }).then(function (j) { test.textContent = j.ok ? ('ok (' + j.status + ')') : 'falhou'; }).catch(function () { test.textContent = 'erro'; });
      return;
    }
    var d = e.target.closest('.wh-del'); if (!d) return;
    var rows = [].slice.call(document.querySelectorAll('#wh-list .wh-row')); var i = rows.indexOf(d.closest('.wh-row')); var l = collectWebhooks(); l.splice(i, 1); state.settings.webhooks = l; renderWebhooks();
  });
  if ($('wh-save')) $('wh-save').addEventListener('click', function () {
    $('wh-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhooks: collectWebhooks() }) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; renderWebhooks(); $('wh-status').textContent = '✅ salvo'; setTimeout(function () { $('wh-status').textContent = ''; }, 2500); } else $('wh-status').textContent = 'erro';
    }).catch(function () { $('wh-status').textContent = 'erro'; });
  });
  if ($('backup-download')) $('backup-download').addEventListener('click', function () {
    api('backup').then(function (r) { return r.blob(); }).then(function (blob) { var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'backup-funilhot.json'; a.click(); URL.revokeObjectURL(a.href); });
  });
  /* ---------- Bot do Telegram ---------- */

  function botLinha(ok, titulo, detalhe) {
    return '<div style="display:flex;gap:9px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line)">'
      + '<span style="flex:none;font-size:15px">' + (ok ? '✅' : '⬜') + '</span>'
      + '<div><div style="font-weight:700">' + esc(titulo) + '</div>'
      + (detalhe ? '<div class="sub">' + esc(detalhe) + '</div>' : '') + '</div></div>';
  }

  function renderBot() {
    var alvo = $('bot-resumo');
    if (alvo) alvo.textContent = 'carregando…';

    // Seletor de período do funil (o servidor aceita de 1 a 90 dias).
    var per = $('bot-periodo');
    if (per && !per.dataset.pronto) {
      per.dataset.pronto = '1';
      per.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          per.querySelectorAll('button').forEach(function (o) { o.classList.remove('on'); });
          b.classList.add('on');
          state.botDias = Number(b.dataset.d);
          renderBot();
        });
      });
    }

    api('bot/panorama').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { if (alvo) alvo.textContent = 'Não consegui carregar.'; return; }

      var pap = $('bot-papel');
      if (pap) pap.textContent = d.papel === 'reserva' ? 'rodando no bot reserva' : '';

      if (alvo) {
        alvo.innerHTML = d.bot && d.bot.username
          ? 'Bot <b>@' + esc(d.bot.username) + '</b> — '
            + (d.bot.webhookOk ? 'recebendo mensagens' : '<b style="color:var(--bad)">sem webhook registrado</b>')
            + (d.bot.ultimoErro ? '<br><span class="sub">último erro: ' + esc(d.bot.ultimoErro) + '</span>' : '')
          : 'Bot não configurado.';
      }

      var falta = [];
      var chatsOk = d.chats.filter(function (c) { return c.ok; }).length;
      if (!d.previas) falta.push('cadastrar prévias');
      if (!d.chats.find(function (c) { return c.chave === 'cofre' && c.ok; })) falta.push('vincular o cofre');
      if (!d.chats.find(function (c) { return c.chave === 'vip' && c.ok; })) falta.push('vincular o grupo VIP');

      var cl = $('bot-checklist');
      if (cl) {
        cl.innerHTML =
          botLinha(Boolean(d.bot && d.bot.webhookOk), 'Bot no ar', d.bot && d.bot.username ? '@' + d.bot.username : '')
          + botLinha(chatsOk >= 2, 'Grupos vinculados', chatsOk + ' de 3')
          + botLinha(d.previas > 0, 'Prévias cadastradas', d.previas + ' no catálogo')
          + botLinha(true, 'Assinantes ativos',
            d.assinantes.ativos + ' ativos · ' + d.assinantes.vencendo + ' vencendo em 3 dias'
            + (d.assinantes.semConvite ? ' · ' + d.assinantes.semConvite + ' sem convite (verificar)' : ''));
      }

      var ch = $('bot-chats');
      if (ch) {
        ch.innerHTML = d.chats.map(function (c) {
          var nome = c.chave === 'cofre' ? 'Canal cofre (guarda as prévias)'
            : c.chave === 'vip' ? 'Grupo VIP (mensal e trimestral)'
              : 'Grupo VIP+ (plano anual)';
          return botLinha(c.ok, nome, c.ok ? c.titulo + ' · ' + c.chatId : 'ainda não vinculado');
        }).join('');
      }

      var pend = $('bot-pendentes');
      if (pend) {
        pend.innerHTML = !d.pendentes.length ? ''
          : '<div class="sub" style="margin-bottom:6px">Detectados, aguardando você escolher:</div>'
            + d.pendentes.map(function (p) {
              return '<div style="display:flex;gap:8px;align-items:center;margin:5px 0">'
                + '<span style="flex:1">' + esc(p.titulo) + ' <span class="sub">' + p.chatId + '</span></span>'
                + '<select class="set-in" style="width:auto" data-pend="' + p.chatId + '">'
                + '<option value="">escolher…</option><option value="vip">Grupo VIP</option>'
                + '<option value="vip-plus">Grupo VIP+</option><option value="cofre">Canal cofre</option></select></div>';
            }).join('');
        pend.querySelectorAll('select[data-pend]').forEach(function (s) {
          s.addEventListener('change', function () {
            if (!s.value) return;
            api('bot/vincular', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chave: s.value, chatId: Number(s.dataset.pend) }),
            }).then(function () { renderBot(); });
          });
        });
      }
    }).catch(function () { if (alvo) alvo.textContent = 'Não consegui carregar.'; });

    renderBotCopy();

    api('bot/previas').then(function (r) { return r.json(); }).then(function (d) {
      var el = $('bot-previas');
      if (!el) return;
      if (!d.ok || !d.items.length) {
        el.innerHTML = '<div class="sub">Nenhuma prévia ainda. Mande as fotos ou vídeos no privado do bot que ele cadastra sozinho.</div>';
        return;
      }
      el.innerHTML = d.items.map(function (it, i) {
        return '<div style="display:flex;gap:9px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">'
          + '<span style="flex:none;font-weight:800;opacity:.5">' + (i + 1) + '</span>'
          + '<span class="sub" style="flex:none;text-transform:uppercase">' + esc(it.kind) + '</span>'
          + '<input class="set-in" style="flex:1;margin:0" value="' + esc(it.caption || '') + '" data-cap="' + esc(it.id) + '" placeholder="legenda…" />'
          + '<button class="btn-ghost" data-del="' + esc(it.id) + '">remover</button></div>';
      }).join('');

      el.querySelectorAll('input[data-cap]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          api('bot/previas', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: 'legenda', id: inp.dataset.cap, caption: inp.value }),
          });
        });
      });
      el.querySelectorAll('button[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Remover esta prévia da sequência?')) return;
          api('bot/previas', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao: 'remover', id: b.dataset.del }),
          }).then(function () { renderBot(); });
        });
      });
    }).catch(function () { /* silencioso */ });

    api('bot/funil?days=' + (state.botDias || 7)).then(function (r) { return r.json(); }).then(function (d) {
      var el = $('bot-funil');
      if (!el || !d.ok) return;

      // Origem do lead — o dado sempre existiu e nunca era mostrado.
      var ori = $('bot-origens');
      if (ori) {
        var ents = Object.keys(d.origens || {}).map(function (k) { return { n: k, v: d.origens[k] }; })
          .sort(function (a, b) { return b.v - a.v; });
        if (!ents.length) {
          ori.innerHTML = '<div class="sub">Ainda sem dados no período.</div>';
        } else {
          var tot = ents.reduce(function (s, e) { return s + e.v; }, 0) || 1;
          var NOMES = { ig: 'Instagram', tiktok: 'TikTok', x: 'X / Twitter', bio: 'Link na bio' };
          ori.innerHTML = ents.map(function (e) {
            var pct = Math.round((e.v / tot) * 100);
            return '<div style="margin:7px 0">'
              + '<div style="display:flex;justify-content:space-between;font-size:12px">'
              + '<span>' + esc(NOMES[e.n] || e.n) + '</span><b>' + e.v + ' <span class="sub">(' + pct + '%)</span></b></div>'
              + '<div style="height:7px;border-radius:4px;background:var(--line);overflow:hidden">'
              + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--violet-2),var(--violet))"></div></div></div>';
          }).join('');
        }
      }
      var etapas = [{ n: 'Começaram', v: d.starts }, { n: 'Confirmaram 18+', v: d.idades }];
      (d.passos || []).forEach(function (v, i) { etapas.push({ n: 'Prévia ' + (i + 1), v: v }); });
      // Este degrau era calculado e descartado — e é justamente o passo
      // imediatamente anterior à venda.
      etapas.push({ n: 'Viram o convite final', v: d.ctas || 0 });
      etapas.push({ n: 'Chegaram ao VIP', v: d.grants });
      var max = Math.max.apply(null, etapas.map(function (e) { return e.v; }).concat([1]));
      el.innerHTML = etapas.map(function (e) {
        var pct = Math.round((e.v / max) * 100);
        return '<div style="margin:7px 0">'
          + '<div style="display:flex;justify-content:space-between;font-size:12px"><span>' + esc(e.n) + '</span><b>' + e.v + '</b></div>'
          + '<div style="height:7px;border-radius:4px;background:var(--line);overflow:hidden">'
          + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--violet-2),var(--violet))"></div></div></div>';
      }).join('');
    }).catch(function () { /* silencioso */ });

    api('bot/assinantes').then(function (r) { return r.json(); }).then(function (d) {
      var el = $('bot-assinantes');
      if (!el || !d.ok) return;
      if (!d.subs.length) { el.innerHTML = '<div class="sub">Nenhum assinante ainda.</div>'; return; }
      el.innerHTML = '<div class="table-scroll"><table class="data"><thead><tr><th>Telegram</th><th>Plano</th><th>Situação</th><th>Vence</th></tr></thead><tbody>'
        + d.subs.map(function (s) {
          var venc = s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('pt-BR') : '-';
          var cor = s.status === 'active' ? 'var(--good)' : s.status === 'removed' ? 'var(--bad)' : '#ffce54';
          return '<tr><td>' + esc(s.uid) + '</td><td>' + esc(s.plan || '-') + '</td>'
            + '<td><b style="color:' + cor + '">' + esc(s.status) + '</b></td><td>' + venc + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function () { /* silencioso */ });
  }

  /** Editor dos textos do bot. */
  function renderBotCopy() {
    var el = $('bot-copy');
    if (!el) return;
    el.innerHTML = '<div class="sub">carregando…</div>';

    api('bot/copy').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { el.innerHTML = '<div class="sub">Não consegui carregar.</div>'; return; }

      el.innerHTML = d.grupos.map(function (g) {
        return '<div class="feat-cat">' + esc(g.nome) + '</div>'
          + g.itens.map(function (it) {
            var dica = it.vars.length ? 'pode usar ' + it.vars.map(function (v) { return '{' + v + '}'; }).join(' ') : '';
            var campo = it.botao
              ? '<input class="set-in" style="margin:0" data-copy="' + esc(it.chave) + '" maxlength="' + it.limite + '" placeholder="' + esc(it.padrao) + '" value="' + esc(it.valor) + '" />'
              : '<textarea class="set-in" style="margin:0;min-height:64px" data-copy="' + esc(it.chave) + '" placeholder="' + esc(it.padrao) + '">' + esc(it.valor) + '</textarea>';
            return '<div style="margin:10px 0" data-linha="' + esc(it.chave) + '">'
              + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">'
              + '<label class="sub">' + esc(rotuloCopy(it.chave)) + (dica ? ' <span style="opacity:.7">— ' + esc(dica) + '</span>' : '') + '</label>'
              + '<button class="link" data-testar="' + esc(it.chave) + '" style="flex:none">testar em mim</button></div>'
              + campo
              + '<div class="sub" data-erro="' + esc(it.chave) + '" style="color:var(--bad);display:none"></div></div>';
          }).join('');
      }).join('');

      el.querySelectorAll('button[data-testar]').forEach(function (b) {
        b.addEventListener('click', function () {
          var chave = b.dataset.testar;
          var campo = el.querySelector('[data-copy="' + chave + '"]');
          b.textContent = 'enviando…';
          // Manda o texto da TELA: você testa o que está vendo, mesmo sem salvar.
          api('bot/copy-testar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave: chave, texto: campo ? campo.value : '' }),
          }).then(function (r) { return r.json(); }).then(function (j) {
            b.textContent = j.ok ? 'chegou ✓' : 'erro';
            if (!j.ok) mostraErroCopy(chave, j.error);
            setTimeout(function () { b.textContent = 'testar em mim'; }, 2500);
          }).catch(function () { b.textContent = 'erro'; });
        });
      });
    }).catch(function () { el.innerHTML = '<div class="sub">Não consegui carregar.</div>'; });
  }

  function mostraErroCopy(chave, msg) {
    var e = document.querySelector('[data-erro="' + chave + '"]');
    if (!e) return;
    e.textContent = msg || '';
    e.style.display = msg ? '' : 'none';
  }

  // Nome amigável de cada mensagem, para a tela não mostrar a chave técnica.
  var COPY_NOMES = {
    'start.saudacao': 'Primeira mensagem (pergunta a idade)',
    'btn.age_sim': 'Botão "sou maior"', 'btn.age_nao': 'Botão "não"',
    'age.ok': 'Depois de confirmar 18+', 'age.negado': 'Quando responde que é menor',
    'btn.proximo': 'Botões de avançar (um por linha)', 'btn.cta': 'Botão de compra (durante)',
    'btn.cta_final': 'Botão de compra (no fim)', 'previas.final': 'Fecho da sequência',
    'previas.vazio': 'Quando não há prévias', 'previas.catalogo_mudou': 'Quando o catálogo muda no meio',
    'fallback.sem_start': 'Se mandar qualquer coisa antes de começar',
    'venda.boas_vindas': 'Acesso liberado após a compra', 'btn.entrar_vip': 'Botão de entrar no VIP',
    'venda.fallback_link': 'Se o convite falhar', 'acesso.link_ok': 'Segunda via do convite',
    'acesso.sem_assinatura': 'Pediu acesso e não tem assinatura', 'acesso.vencido': 'Pediu acesso e está vencido',
    'acesso.limite_diario': 'Pediu o link vezes demais', 'acesso.erro_link': 'Falha ao gerar o link',
    'acesso.erro_interno': 'Erro interno', 'entrada.negada': 'Tentou entrar no grupo sem assinatura',
    'status.ativo': 'Situação: VIP ativo', 'status.vencido': 'Situação: vencido',
    'status.sem_vip': 'Situação: nunca comprou', 'btn.quero_entrar': 'Botão "quero entrar"',
    'claim.nao_pago': 'Resgate: pagamento ainda não caiu', 'claim.invalido': 'Resgate: link inválido',
    'suporte.resposta': 'Resposta do /suporte',
    'venc.aviso': 'Aviso de vencimento (3 e 1 dia antes)', 'btn.renovar': 'Botão de renovar',
    'venc.fim': 'Quando o acesso termina', 'btn.winback': 'Botão de voltar pro VIP',
  };
  function rotuloCopy(chave) { return COPY_NOMES[chave] || chave; }

  if ($('copy-save')) {
    $('copy-save').addEventListener('click', function () {
      var textos = {};
      document.querySelectorAll('[data-copy]').forEach(function (c) {
        textos[c.dataset.copy] = c.value;
        mostraErroCopy(c.dataset.copy, '');
      });
      var st = $('copy-status');
      st.textContent = 'salvando…';
      api('bot/copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textos: textos }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) {
          st.textContent = 'salvo ✓ (vale para todo mundo em até 1 minuto)';
          setTimeout(function () { st.textContent = ''; }, 4000);
          return;
        }
        st.textContent = 'confira os campos em vermelho';
        (j.erros || []).forEach(function (e) { mostraErroCopy(e.chave, e.erro); });
        var primeiro = document.querySelector('[data-linha="' + ((j.erros || [])[0] || {}).chave + '"]');
        if (primeiro) primeiro.scrollIntoView({ block: 'center' });
      }).catch(function () { st.textContent = 'erro ao salvar'; });
    });
  }

  function renderIntegracoes() { renderWebhooks(); }

  // ---------- Central de remarketing (WhatsApp por segmento) ----------
  var REM_TPL = { abandonado: 'recoveryMsg', vencendo: 'expiringMsg', expirado: 'winbackMsg', novo: 'welcomeMsg' };
  function remRecipients(seg) {
    var now = Date.now(), DAY = 86400000, out = [];
    if (seg === 'abandonado') {
      (state.abandonedList || []).forEach(function (o) { if (o.telefone) out.push({ name: o.nome, telefone: o.telefone, info: o.label }); });
    } else {
      var m = (state.membersData && state.membersData.members) || [];
      m.forEach(function (x) {
        if (!x.telefone) return;
        if (seg === 'vencendo' && x.active && x.daysLeft <= 7) out.push({ name: x.name, telefone: x.telefone, info: 'vence em ' + x.daysLeft + 'd' });
        else if (seg === 'expirado' && !x.active) out.push({ name: x.name, telefone: x.telefone, info: 'acesso expirado' });
        else if (seg === 'novo' && x.startAt >= now - 7 * DAY) out.push({ name: x.name, telefone: x.telefone, info: 'novo membro' });
      });
    }
    return out;
  }
  function renderRemList() {
    var seg = state.remSegment || 'abandonado';
    var list = remRecipients(seg);
    if ($('rem-count')) $('rem-count').textContent = 'Destinatários (' + list.length + ')';
    if (!$('rem-list')) return;
    var tpl = ($('rem-msg') && $('rem-msg').value) || '';
    $('rem-list').innerHTML = tableHTML(
      [{ t: 'Cliente' }, { t: 'Situação' }, { t: 'Enviar' }],
      list.slice(0, 200).map(function (r) {
        var phone = String(r.telefone).replace(/\D/g, '');
        var msg = tpl.replace(/{nome}/g, (r.name || '').split(' ')[0]).replace(/{produto}/g, r.info || '');
        var wa = phone ? '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/55' + phone + '?text=' + encodeURIComponent(msg) + '">💬 WhatsApp</a>' : '<span class="sub">sem telefone</span>';
        return [esc(r.name) + '<div class="sub">' + esc(maskPhone(r.telefone)) + '</div>', esc(r.info || ''), wa];
      }),
      'Ninguém neste segmento agora.'
    );
  }
  function renderRemarketing() {
    if (!state.membersData) loadMembers();
    var seg = state.remSegment || 'abandonado';
    if ($('rem-msg')) $('rem-msg').value = (state.settings && state.settings[REM_TPL[seg]]) || '';
    renderRemList();
  }
  if ($('rem-seg')) $('rem-seg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('rem-seg').querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on'); state.remSegment = b.dataset.seg; renderRemarketing();
  });
  if ($('rem-msg')) $('rem-msg').addEventListener('input', renderRemList);
  if ($('rem-save')) $('rem-save').addEventListener('click', function () {
    var seg = state.remSegment || 'abandonado', patch = {};
    patch[REM_TPL[seg]] = $('rem-msg').value;
    $('rem-status').textContent = 'salvando…';
    api('settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { state.settings = j.settings; $('rem-status').textContent = '✅ salvo'; setTimeout(function () { $('rem-status').textContent = ''; }, 2500); } else $('rem-status').textContent = 'erro';
    }).catch(function () { $('rem-status').textContent = 'erro'; });
  });

  function boot() {
    $('login').style.display = 'none';
    $('app').classList.add('on');
    showView('overview');
    loadConfig();
    load();
    loadMembers();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(load, 60000);
  }

  // sessão existente?
  if (token()) {
    fetch('/api/admin/ping', { headers: { 'x-admin-key': token() } }).then(function (r) { if (r.ok) boot(); else logout(); }).catch(logout);
  }
})();
