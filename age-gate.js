// Barreira de idade 18+ (recurso verificacao_idade). Mostra um overlay até o
// visitante confirmar. Some sozinha se o recurso estiver desligado no painel.
(function () {
  'use strict';
  try { if (localStorage.getItem('funil_age_ok') === '1') return; } catch (e) { /* */ }

  var ov = document.createElement('div');
  ov.id = 'age-gate';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(8,6,14,.97);display:flex;align-items:center;justify-content:center;padding:24px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)';
  ov.innerHTML = '<div style="max-width:380px;text-align:center;background:#15101d;border:1px solid rgba(255,105,180,.35);border-radius:20px;padding:30px 26px;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
    '<div style="font-size:40px;margin-bottom:8px">🔞</div>' +
    '<h2 style="color:#fff;font-size:20px;margin:0 0 8px">Conteúdo adulto</h2>' +
    '<p style="color:#c9c4d6;font-size:14px;line-height:1.5;margin:0 0 20px">Este site contém material explícito para maiores de 18 anos. Ao continuar, você confirma que é maior de idade.</p>' +
    '<button id="age-yes" style="width:100%;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#ff4d94,#b34bff);color:#fff;font-weight:800;font-size:15px;cursor:pointer">Tenho 18+ — entrar</button>' +
    '<button id="age-no" style="width:100%;margin-top:10px;padding:12px;border:none;border-radius:12px;background:transparent;color:#9a93a8;font-size:13px;cursor:pointer">Sair</button></div>';

  function mount() { if (document.body) document.body.appendChild(ov); else setTimeout(mount, 30); }
  mount();

  // Se o recurso estiver desligado no painel, remove a barreira. Se o fetch
  // falhar, mantém a barreira por segurança (é um site adulto).
  fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok || !j.features || !j.features.verificacao_idade) { if (ov.parentNode) ov.parentNode.removeChild(ov); }
  }).catch(function () { /* mantém */ });

  document.addEventListener('click', function (e) {
    if (!e.target) return;
    if (e.target.id === 'age-yes') { try { localStorage.setItem('funil_age_ok', '1'); } catch (er) { /* */ } if (ov.parentNode) ov.parentNode.removeChild(ov); }
    else if (e.target.id === 'age-no') { window.location.href = 'https://www.google.com'; }
  });
})();
