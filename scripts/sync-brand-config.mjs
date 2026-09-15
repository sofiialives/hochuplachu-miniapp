// Подтягивает brand-конфиг для dev-режима (ng serve), повторяя логику
// docker-entrypoint.sh. Идемпотентен; запускается через `npm start` →
// `npm run brand:sync`.
//
// Источник — process.env.BRAND_CONFIG_URL (передаётся через --env-file=.env).
// Поддерживается http(s) URL ИЛИ локальный путь (опционально file://).
// TLS verify отключён всегда — brand.json статический ассет без секретов,
// dev часто живёт на самоподписанных cert'ах (bitrex.test).

import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const BRAND_CONFIG_URL = process.env.BRAND_CONFIG_URL;
const API_BASE_URL = process.env.API_BASE_URL ?? '/api/v1';
// Домен чат-прокси cc-gochatwoot для web-чата поддержки; пусто = чат выключен
// (паритет с docker-entrypoint.sh, см. ChatwootConfig в runtime-config.service.ts).
const CHATWOOT_HOST = process.env.CHATWOOT_HOST ?? '';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '..', 'public', 'assets');
const BRAND_JSON_PATH = resolve(ASSETS_DIR, 'brand.json');
const RUNTIME_CONFIG_PATH = resolve(ASSETS_DIR, 'runtime-config.js');

if (!BRAND_CONFIG_URL) {
  console.error('ERROR: BRAND_CONFIG_URL is not set (.env не загружен или поле отсутствует)');
  process.exit(1);
}

mkdirSync(ASSETS_DIR, { recursive: true });

const isHTTP = (s) => /^https?:\/\//i.test(s);
const stripFile = (s) => s.replace(/^file:\/\//, '');

async function fetchToBuffer(src) {
  if (isHTTP(src)) {
    // Node 20+ fetch; самоподписанные cert'ы — отключаем TLS verify (см. шапку).
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const res = await fetch(src);
    if (!res.ok) throw new Error(`GET ${src} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFileSync(stripFile(src));
}

async function fetchToFile(src, dst) {
  if (isHTTP(src)) {
    const buf = await fetchToBuffer(src);
    writeFileSync(dst, buf);
  } else {
    copyFileSync(stripFile(src), dst);
  }
}

console.log(`brand: fetching ${BRAND_CONFIG_URL}`);
const brandBuf = await fetchToBuffer(BRAND_CONFIG_URL);
const brand = JSON.parse(brandBuf.toString('utf8'));
writeFileSync(BRAND_JSON_PATH, brandBuf);

function extOf(url, fallback = 'png') {
  const m = url.toLowerCase().match(/\.(png|jpg|jpeg|svg|webp|ico)(?:[?#]|$)/);
  return m ? m[1] : fallback;
}

// rasterizeSVG — берёт SVG-файл с диска и рисует PNG 256×256 рядом.
// Safari/iOS не рендерят SVG-favicon, а apple-touch-icon требует PNG —
// поэтому всегда держим обе версии (см. applyFavicon на клиенте).
function rasterizeSVG(srcSvgPath, dstPngPath, size = 256) {
  const svg = readFileSync(srcSvgPath, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  const png = resvg.render().asPng();
  writeFileSync(dstPngPath, png);
}

// Лого — детектим расширение и сохраняем под /assets/logo.{ext}. Затем
// подменяем brand.logo_url на локальный путь, чтобы frontend ссылался на него
// вместо внешнего CDN. Сохраняем оригинальный URL отдельно — favicon-fallback
// должен идти от него (не от уже подменённого локального пути).
const originalLogoURL = brand.logo_url || '';
let logoLocalPath = '';
if (originalLogoURL) {
  const ext = extOf(originalLogoURL);
  const logoLocal = `/assets/logo.${ext}`;
  logoLocalPath = resolve(ASSETS_DIR, `logo.${ext}`);
  try {
    console.log(`brand: fetching logo ${originalLogoURL} → ${logoLocalPath}`);
    await fetchToFile(originalLogoURL, logoLocalPath);
    brand.logo_url = logoLocal;
  } catch (e) {
    console.warn(`brand: cannot fetch logo from ${originalLogoURL}: ${e.message}; keeping original URL`);
    logoLocalPath = '';
  }
}

// Favicon — необязательное поле. Если favicon_url задан — скачиваем его как
// отдельный ресурс. Если пуст — копируем уже скачанный logo-файл с диска,
// чтобы не дёргать внешний URL повторно. runtime-config.service.applyFavicon()
// подменит <link rel="icon"> на клиенте.
//
// Если итоговая иконка — SVG, дополнительно растеризуем её в PNG 256×256
// и кладём оба файла. Safari/iOS игнорируют SVG-favicon, apple-touch-icon —
// тоже PNG-only. brand.favicon_png_url передаётся в runtime-config отдельно,
// applyFavicon добавляет оба <link>.
const explicitFaviconURL = brand.favicon_url || '';
let faviconLocalPath = '';
let faviconLocalURL = '';
let faviconExt = '';
if (explicitFaviconURL) {
  faviconExt = extOf(explicitFaviconURL);
  faviconLocalURL = `/assets/favicon.${faviconExt}`;
  faviconLocalPath = resolve(ASSETS_DIR, `favicon.${faviconExt}`);
  try {
    console.log(`brand: fetching favicon ${explicitFaviconURL} → ${faviconLocalPath}`);
    await fetchToFile(explicitFaviconURL, faviconLocalPath);
    brand.favicon_url = faviconLocalURL;
  } catch (e) {
    console.warn(`brand: cannot fetch favicon from ${explicitFaviconURL}: ${e.message}; keeping original URL`);
    faviconLocalPath = '';
  }
} else if (logoLocalPath) {
  faviconExt = extOf(originalLogoURL);
  faviconLocalURL = `/assets/favicon.${faviconExt}`;
  faviconLocalPath = resolve(ASSETS_DIR, `favicon.${faviconExt}`);
  console.log(`brand: favicon_url пуст — копирую logo → ${faviconLocalPath}`);
  copyFileSync(logoLocalPath, faviconLocalPath);
  brand.favicon_url = faviconLocalURL;
}

if (faviconLocalPath && faviconExt === 'svg') {
  const pngPath = resolve(ASSETS_DIR, 'favicon.png');
  try {
    console.log(`brand: rasterize ${faviconLocalPath} → ${pngPath}`);
    rasterizeSVG(faviconLocalPath, pngPath, 256);
    brand.favicon_png_url = '/assets/favicon.png';
  } catch (e) {
    console.warn(`brand: cannot rasterize ${faviconLocalPath}: ${e.message}; Safari увидит дефолтный favicon`);
  }
}

// Inline-функция в <head>, до парсинга <body>:
//   1. Ставит CSS-переменные --color-* и --brand-logo на <html>, чтобы splash
//      в index.html сразу красился в брендовые цвета и показывал правильный
//      логотип — никакой «вспышки defaults → brand».
//   2. Ставит <link rel="icon"> с правильным URL.
//   3. Preload'ит лого — back-bar не моргает после bootstrap'а Angular.
// Логика дублирует RuntimeConfigService.applyFavicon/applyThemeFromConfig —
// они остаются как fallback (data-favicon-applied=1 сигналит skip).
const BRAND_BOOTSTRAP = `(function(){
  var cfg=window.__APP_CONFIG__||{};
  var b=cfg.brand||{};
  var root=document.documentElement;
  var head=document.head;
  var colors=b.colors||{};
  Object.keys(colors).forEach(function(k){
    if(colors[k]) root.style.setProperty('--color-'+k.replace(/_/g,'-'), colors[k]);
  });
  var logoUrl=(b.logo_url||'').trim();
  if(logoUrl){
    root.style.setProperty('--brand-logo', 'url("'+logoUrl.replace(/"/g,'\\\\"')+'")');
  }
  var svcName=(b.service_name||'').trim();
  if(svcName){
    document.title=svcName;
    var desc=svcName+' — выпуск виртуальных карт и пополнения для оплаты зарубежных сервисов';
    var md=head.querySelector('meta[name="description"]');
    if(!md){md=document.createElement('meta');md.setAttribute('name','description');head.appendChild(md);}
    md.setAttribute('content',desc);
  }
  function addLink(rel,href,type,as){var l=document.createElement('link');l.rel=rel;l.href=href;if(type)l.type=type;if(as)l.as=as;head.appendChild(l);}
  function mimeFor(u){var m=u.toLowerCase().match(/\\.(png|jpg|jpeg|svg|webp|ico)(?:[?#]|$)/);if(!m) return undefined;var t=m[1];return t==='svg'?'image/svg+xml':t==='ico'?'image/x-icon':'image/'+(t==='jpg'?'jpeg':t);}
  var url=(b.favicon_url||b.logo_url||'').trim();
  if(url){
    var pngFallback=(b.favicon_png_url||'').trim();
    var isSvg=/\\.svg(?:[?#]|$)/i.test(url);
    head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(function(el){el.remove();});
    addLink('icon',url,mimeFor(url));
    if(isSvg&&pngFallback){addLink('icon',pngFallback,'image/png');addLink('apple-touch-icon',pngFallback);}
    else if(!isSvg){addLink('apple-touch-icon',url);}
    head.setAttribute('data-favicon-applied','1');
  }
  if(logoUrl){addLink('preload',logoUrl,mimeFor(logoUrl),'image');}
})();`;

const cfgObj = {
  apiBaseUrl: API_BASE_URL,
  brand,
  chatwoot: { host: CHATWOOT_HOST },
};
writeFileSync(
  RUNTIME_CONFIG_PATH,
  `// Сгенерировано scripts/sync-brand-config.mjs (npm run brand:sync) — не правьте вручную.\n` +
    `window.__APP_CONFIG__ = ${JSON.stringify(cfgObj, null, 2)};\n` +
    BRAND_BOOTSTRAP +
    `\n`,
);

console.log(`brand: ${BRAND_JSON_PATH}\nbrand: ${RUNTIME_CONFIG_PATH} ready`);
