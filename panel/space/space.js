/* Atlas — 3B yıldız haritası (Three.js, derleme adımı yok).
 *
 * TEK KAYNAK: /space/space.js. panel/space/space.js birebir kopyadır (panel ayrı
 * Vercel projesi); tools/space-sync-test.js ikisinin aynı kaldığını denetler.
 *
 * Sayfa gereksinimi (module'den ÖNCE):
 *   <script type="importmap">{"imports":{"three":"…three@0.160.0/build/three.module.js",
 *     "three/addons/":"…three@0.160.0/examples/jsm/"}}</script>
 *   <canvas id="space3d" data-space="hero|panel" aria-hidden="true"></canvas>
 *   <script type="module" src="space/space.js"></script>
 *
 * Katmanlar (tek WebGL bağlamı):
 *   1. Nebula + kayan yıldızlar: tam ekran üçgen, domain-warp fbm'li iki katman
 *      (farklı paralaks → hacim hissi). Kayan yıldızlar aynı shader'da (3 yuva).
 *   2. Yıldızlar: THREE.Points, masaüstünde 50.000 / mobilde 10.000; twinkle
 *      vertex shader'da, %35'i eğik bir "galaksi bandı"nda.
 *   3. Efektler: Bloom → sinematik geçiş (renk sapması, vinyet, film greni).
 *      OutputPass YOK: shader renkleri zaten ekran (sRGB) değerleri; doğrusal→sRGB
 *      dönüşümü koyu nebulayı griye çevirirdi. Son geçiş doğrudan ekrana yazar.
 *
 * Kamera: fare paralaksı (yumuşak lerp) + kaydırmayla hafif dönüş/ilerleme.
 * Performans: sekme gizliyken durur; ilk ~2 sn kare süresi ölçülür, 60 FPS
 * tutmuyorsa kalite kademeli düşer (piksel oranı → yıldız sayısı → efektler).
 * prefers-reduced-motion: tek sabit kare (twinkle/kayan yıldız/paralaks yok).
 * Başarısızlıkta (WebGL yok, CDN yok, bağlam kaybı) sayfanın kendi yedeği kalır:
 * html.space-3d sınıfı yalnızca ilk kare çizilince eklenir.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const canvas = document.getElementById("space3d");
const mode = (canvas && canvas.dataset.space) || "hero";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches || innerWidth < 768;
const conn = navigator.connection || {};
const lowEnd = conn.saveData === true || (navigator.deviceMemory && navigator.deviceMemory <= 2);

const STAR_COUNT = coarse ? 10000 : 50000;
/* Panelde metin okunurluğu için nebula daha sönük. */
const NEBULA = mode === "panel" ? 0.8 : 1.25;

const STAR_VS = /* glsl */`
  attribute float aSize; attribute float aPhase; attribute float aSpeed; attribute vec3 aColor;
  uniform float uTime; uniform float uPixelRatio; uniform float uTwinkle;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase);
    vAlpha = mix(0.85, tw, uTwinkle);
    vColor = aColor;
    /* Uzaklıkla küçülür; 1.6 pikselin altına inmez (alt-piksel nokta titrer ve
       kaybolur) — küçülmesi gereken yıldız bunun yerine sönükleşir. */
    float size = aSize * uPixelRatio * (900.0 / -mv.z);
    float minSize = 1.6 * uPixelRatio;
    vAlpha *= clamp(size / minSize, 0.25, 1.0);
    gl_PointSize = clamp(size, minSize, 22.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FS = /* glsl */`
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    float a = (pow(core, 2.4) + 0.35 * pow(core, 9.0)) * vAlpha;
    if (a < 0.008) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;

const NEB_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const NEB_FS = /* glsl */`
  precision highp float;
  uniform float uTime; uniform vec2 uRes; uniform vec2 uOffset; uniform float uIntensity;
  uniform vec4 uShoot[3];   // xy: başlangıç (ekran, -1..1), z: açı, w: ilerleme 0..1 (<0 kapalı)
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
    return v;
  }
  vec3 cloud(vec2 p, float t, vec3 a, vec3 b, vec3 c) {
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
    vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2)), fbm(p + 3.0 * q + vec2(8.3, 2.8)));
    float n = fbm(p + 2.6 * r);
    vec3 col = mix(a, b, clamp(q.x * 1.4, 0.0, 1.0));
    col = mix(col, c, clamp(r.y * r.y * 1.6, 0.0, 1.0));
    return col * smoothstep(0.22, 0.85, n) * (0.7 + 1.1 * n);
  }
  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float t = uTime * 0.012;
    vec3 col = vec3(0.012, 0.008, 0.035);
    col += cloud(uv * 1.15 + uOffset * 0.25 + vec2(t * 0.3, 0.0), t,
                 vec3(0.22, 0.05, 0.42), vec3(0.03, 0.30, 0.42), vec3(0.62, 0.12, 0.42)) * 0.75;
    col += cloud(uv * 2.1 + uOffset * 0.6 + vec2(-t * 0.5, 4.0), t * 1.3,
                 vec3(0.05, 0.22, 0.40), vec3(0.40, 0.26, 0.06), vec3(0.20, 0.06, 0.38)) * 0.45;
    col *= uIntensity * smoothstep(1.35, 0.15, length(uv * vec2(0.8, 1.0)));
    for (int i = 0; i < 3; i++) {
      vec4 s = uShoot[i];
      if (s.w < 0.0) continue;
      vec2 dir = vec2(cos(s.z), sin(s.z));
      vec2 head = s.xy * vec2(uRes.x / uRes.y, 1.0) + dir * s.w * 1.6;
      vec2 tail = head - dir * 0.38;
      vec2 pa = uv - tail, ba = head - tail;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);
      float fade = sin(3.14159 * s.w);
      col += vec3(0.85, 0.95, 1.0) * smoothstep(0.004, 0.0, d) * h * h * fade * 1.8;
      col += vec3(0.40, 0.85, 1.0) * smoothstep(0.03, 0.0, d) * h * fade * 0.25;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const CINEMA = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.003 }, uGrain: { value: 0.035 }, uVignette: { value: 1.05 }
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uCA; uniform float uGrain; uniform float uVignette;
    varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * uCA * (0.08 + 5.0 * dot(d, d));   // merkez neredeyse temiz, kenarlar saçaklı
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(0.42, 1.0, smoothstep(0.9, 0.18, length(d) * uVignette));
      col += (rand(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`
};

const PALETTE = [
  [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1],
  [0.61, 0.91, 1.0], [0.61, 0.91, 1.0],      // cyan
  [1.0, 0.84, 0.52], [1.0, 0.84, 0.52],      // altın
  [1.0, 0.72, 0.9],                          // pembe
  [0.78, 0.84, 1.0]                          // çivit
];

function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

function buildStars(count) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const size = new Float32Array(count), phase = new Float32Array(count), speed = new Float32Array(count);
  const tilt = new THREE.Matrix4().makeRotationZ(-0.45).multiply(new THREE.Matrix4().makeRotationX(0.35));
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const r = 180 + Math.pow(Math.random(), 0.6) * 900;
    if (i % 100 < 35) {
      /* Galaksi bandı: eğik bir düzlemde ince disk. */
      const a = Math.random() * Math.PI * 2;
      v.set(Math.cos(a) * r, gauss() * r * 0.07, Math.sin(a) * r).applyMatrix4(tilt);
    } else {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      v.set(s * Math.cos(a) * r, u * r, s * Math.sin(a) * r);
    }
    pos.set([v.x, v.y, v.z], i * 3);
    const c = PALETTE[(Math.random() * PALETTE.length) | 0];
    const dim = 0.55 + Math.random() * 0.45;
    col.set([c[0] * dim, c[1] * dim, c[2] * dim], i * 3);
    /* Güç yasası: çoğu sönük, azı parlak (bloom bunları parlatır). */
    size[i] = 0.7 + Math.pow(Math.random(), 7) * 5.5;
    phase[i] = Math.random() * Math.PI * 2;
    speed[i] = 0.6 + Math.random() * 2.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  return g;
}

function start() {
  if (!canvas || lowEnd) return;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  } catch (e) {
    return;   // WebGL yok: sayfanın yedeği kalır
  }
  let pixelRatio = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  canvas.dataset.quality = "0";
  canvas.dataset.stars = String(STAR_COUNT);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1, 3000);

  const nebulaMat = new THREE.ShaderMaterial({
    vertexShader: NEB_VS, fragmentShader: NEB_FS, depthWrite: false, depthTest: false,
    uniforms: {
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uOffset: { value: new THREE.Vector2() }, uIntensity: { value: NEBULA },
      uShoot: { value: [new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1), new THREE.Vector4(0, 0, 0, -1)] }
    }
  });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const nebula = new THREE.Mesh(tri, nebulaMat);
  nebula.frustumCulled = false;
  nebula.renderOrder = -1;
  scene.add(nebula);

  const starGeo = buildStars(STAR_COUNT);
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio }, uTwinkle: { value: reduced ? 0 : 1 } }
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), mode === "panel" ? 0.6 : 0.9, 0.5, 0.34);
  composer.addPass(bloom);
  const cinema = new ShaderPass(CINEMA);
  composer.addPass(cinema);

  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    nebulaMat.uniforms.uRes.value.set(w, h);
    cinema.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    if (reduced) frame(performance.now());
  }
  addEventListener("resize", resize);

  /* Fare paralaksı + kaydırma. */
  let mx = 0, my = 0, tx = 0, ty = 0, scroll = 0;
  if (!reduced && !coarse) {
    addEventListener("pointermove", (e) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; }, { passive: true });
  }
  addEventListener("scroll", () => { scroll = scrollY; }, { passive: true });

  /* Kayan yıldızlar: 3 yuva, 3–8 sn arayla. */
  const shoots = nebulaMat.uniforms.uShoot.value;
  let nextShoot = 2.5;
  function updateShoots(t, dt) {
    if (reduced) return;
    shoots.forEach((s) => { if (s.w >= 0) { s.w += dt / 1.1; if (s.w > 1) s.w = -1; } });
    if (t > nextShoot) {
      const free = shoots.find((s) => s.w < 0);
      if (free) free.set(-0.2 + Math.random() * 1.1, 0.35 + Math.random() * 0.55, Math.PI + 0.35 + Math.random() * 0.45, 0);
      nextShoot = t + 3 + Math.random() * 5;
    }
  }

  /* Uyarlanır kalite: 60 FPS tutmuyorsa sırayla düş. */
  let samples = [], level = 0;
  function adapt(dt) {
    if (reduced || level > 3) return;
    samples.push(dt);
    if (samples.length < 90) return;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples = [];
    if (avg < 1 / 50) return;
    level += 1;
    canvas.dataset.quality = String(level);   // 0 = tam kalite; tarayıcı konsolunda görülebilir
    if (level === 1) { pixelRatio = 1; renderer.setPixelRatio(1); starMat.uniforms.uPixelRatio.value = 1; resize(); }
    else if (level === 2) starGeo.setDrawRange(0, Math.floor(STAR_COUNT * 0.5));
    else if (level === 3) { bloom.enabled = false; cinema.uniforms.uCA.value = 0; }
    else { cinema.enabled = false; starGeo.setDrawRange(0, Math.floor(STAR_COUNT * 0.3)); }
  }

  let last = performance.now(), elapsed = 0, running = true, shown = false;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;
    mx += (tx - mx) * 0.04;
    my += (ty - my) * 0.04;
    const drift = reduced ? 0 : elapsed * 0.006;
    stars.rotation.y = drift + scroll * 0.00012;
    stars.rotation.x = scroll * 0.00004;
    camera.rotation.y = -mx * 0.12;
    camera.rotation.x = -my * 0.08;
    camera.position.z = -Math.min(scroll * 0.03, 60);
    nebulaMat.uniforms.uOffset.value.set(mx * 0.6 + drift * 2, -my * 0.4 + scroll * 0.00025);
    nebulaMat.uniforms.uTime.value = reduced ? 0 : elapsed;
    starMat.uniforms.uTime.value = elapsed;
    cinema.uniforms.uTime.value = elapsed;
    updateShoots(elapsed, dt);
    composer.render(dt);
    if (!shown) {
      shown = true;
      document.documentElement.classList.add("space-3d");
      window.__space3d = true;
      dispatchEvent(new CustomEvent("space:ready", { detail: { stars: STAR_COUNT, mode } }));
    }
    adapt(dt);
  }
  function loop(now) {
    if (!running) return;
    frame(now);
    requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    running = !document.hidden;
    if (running) { last = performance.now(); requestAnimationFrame(loop); }
  });
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    running = false;
    document.documentElement.classList.remove("space-3d");
    window.__space3d = false;
    dispatchEvent(new CustomEvent("space:lost"));
  });

  if (reduced) frame(performance.now());
  else requestAnimationFrame(loop);
}

start();
