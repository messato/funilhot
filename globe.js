/* Globo 3D neon (three.js, self-hosted). Continentes = pontos de domínio
   público (Natural Earth). Fallback: se não houver WebGL, mantém o globo CSS. */
(function () {
  var wrap = document.querySelector('.globe-wrap');
  if (!wrap || !window.THREE) return;
  try {
    var t = document.createElement('canvas');
    if (!(t.getContext('webgl') || t.getContext('experimental-webgl'))) return;
  } catch (e) { return; }

  var THREE = window.THREE;
  var W = wrap.clientWidth || 200, H = wrap.clientHeight || 200;

  var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  var cv = renderer.domElement;
  cv.style.position = 'absolute'; cv.style.left = '0'; cv.style.top = '0'; cv.style.cursor = 'grab';

  // esconde o globo CSS (fallback) e os pontos decorativos; mantém o .globe-rim
  var cssGlobe = wrap.querySelector('.globe'); if (cssGlobe) cssGlobe.style.display = 'none';
  wrap.querySelectorAll('.globe-dot').forEach(function (d) { d.style.display = 'none'; });
  wrap.insertBefore(cv, wrap.firstChild);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 100);
  camera.position.z = 3.15;

  var globe = new THREE.Group();
  globe.rotation.x = 0.32;
  scene.add(globe);

  var R = 1;
  function toXYZ(lng, lat, r) {
    var phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180;
    return { x: -r * Math.sin(phi) * Math.cos(theta), y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(theta) };
  }

  // oceano: esfera opaca escura (oculta os continentes do lado de trás)
  globe.add(new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.985, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x0b0d24 })
  ));
  // graticulado sutil
  globe.add(new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(R, 24, 16)),
    new THREE.LineBasicMaterial({ color: 0x3a3a7a, transparent: true, opacity: 0.22 })
  ));

  // continentes (pontos) — cor em gradiente violeta→ciano por latitude
  var land = window.__LAND__ || [];
  var geo = new THREE.BufferGeometry();
  var pos = new Float32Array(land.length * 3), col = new Float32Array(land.length * 3);
  var cA = new THREE.Color(0x7c5cff), cB = new THREE.Color(0x22d3ee), c = new THREE.Color();
  for (var i = 0; i < land.length; i++) {
    var v = toXYZ(land[i][0], land[i][1], R * 1.004);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    c.copy(cA).lerp(cB, (land[i][1] + 90) / 180);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  globe.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.95 })));

  // atmosfera (glow ciano no aro)
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.18, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.10, side: THREE.BackSide, blending: THREE.AdditiveBlending })
  ));

  // arrastar pra girar
  var dragging = false, px = 0, py = 0, spin = 0.0018;
  cv.addEventListener('pointerdown', function (e) { dragging = true; px = e.clientX; py = e.clientY; cv.style.cursor = 'grabbing'; });
  window.addEventListener('pointerup', function () { dragging = false; cv.style.cursor = 'grab'; });
  window.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    globe.rotation.y += (e.clientX - px) * 0.005;
    globe.rotation.x = Math.max(-1.2, Math.min(1.2, globe.rotation.x + (e.clientY - py) * 0.005));
    px = e.clientX; py = e.clientY;
  });

  function resize() {
    W = wrap.clientWidth || 200; H = wrap.clientHeight || 200;
    renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
  }
  window.__globeResize = resize;
  window.addEventListener('resize', resize);

  (function tick() {
    requestAnimationFrame(tick);
    if (!dragging) globe.rotation.y += spin;
    renderer.render(scene, camera);
  })();
})();
