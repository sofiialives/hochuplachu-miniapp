#!/bin/sh
set -e

# Frontend entrypoint (nginx runtime):
#   1. Получает brand.json — BRAND_CONFIG_URL может быть http(s)-URL ИЛИ
#      локальным путём (опционально с префиксом file://). Локальный вариант
#      удобен в dev — смонтировать json как volume и не поднимать веб-сервер.
#   2. Сохраняет его в assets/brand.json — клиентская логика и при желании
#      backend могут запросить тот же JSON.
#   3. Скачивает/копирует logo_url из brand.json в assets/logo.{ext}.
#   4. Скачивает favicon (или копирует logo) и при необходимости растеризует SVG в PNG.
#   5. Генерит runtime-config.js: там встроен brand целиком + apiBaseUrl, и
#      inline-bootstrap, который:
#        — ставит CSS-переменные --color-* и --brand-logo на <html> ДО paint'a,
#          чтобы splash в index.html сразу красился в брендовые цвета;
#        — переопределяет <link rel="icon">.
#
# brand.json — единый источник правды для backend и frontend. Не путать с
# API_BASE_URL — это технический параметр, не часть бренда.

BROWSER_DIR="/usr/share/nginx/html"
ASSETS_DIR="${BROWSER_DIR}/assets"
BRAND_JSON_PATH="${ASSETS_DIR}/brand.json"
CONFIG_JS="${ASSETS_DIR}/runtime-config.js"

mkdir -p "${ASSETS_DIR}"

if [ -z "${BRAND_CONFIG_URL:-}" ]; then
  echo "ERROR: BRAND_CONFIG_URL is required (http(s) URL or local path to brand.json)" >&2
  exit 1
fi

# fetch_to <src> <dst> — забирает файл по http(s)-URL или копирует с диска.
fetch_to() {
  src="$1"
  dst="$2"
  case "${src}" in
    http://*|https://*)
      curl -fsSL "${src}" -o "${dst}"
      ;;
    file://*)
      cp "${src#file://}" "${dst}"
      ;;
    *)
      cp "${src}" "${dst}"
      ;;
  esac
}

echo "fetching brand config: ${BRAND_CONFIG_URL}"
fetch_to "${BRAND_CONFIG_URL}" "${BRAND_JSON_PATH}"

# Логотип — отдельным запросом, чтобы nginx отдавал его как статический
# /assets/logo.{ext} без хождения в наружный CDN. Поддерживаемые расширения —
# .png, .jpg, .jpeg, .svg, .webp. Если URL не содержит явного расширения —
# fallback на .png.
LOGO_URL=$(node -e "const b=JSON.parse(require('fs').readFileSync('${BRAND_JSON_PATH}','utf8'));process.stdout.write(b.logo_url||'')")
LOGO_LOCAL=""
LOGO_PATH=""
LOGO_EXT=""
if [ -n "${LOGO_URL}" ]; then
  LOGO_EXT=$(node -e "const u='${LOGO_URL}'.toLowerCase();const m=u.match(/\.(png|jpg|jpeg|svg|webp)(?:[?#]|$)/);process.stdout.write(m?m[1]:'png')")
  LOGO_LOCAL="/assets/logo.${LOGO_EXT}"
  LOGO_PATH="${ASSETS_DIR}/logo.${LOGO_EXT}"
  echo "fetching logo: ${LOGO_URL} -> ${LOGO_PATH}"
  if fetch_to "${LOGO_URL}" "${LOGO_PATH}"; then
    :
  else
    echo "WARN: cannot fetch logo from ${LOGO_URL}; keeping original brand.logo_url"
    LOGO_LOCAL=""
    LOGO_PATH=""
  fi
fi

# Favicon — опциональное поле brand.json. Если favicon_url задан — скачиваем
# его отдельным ресурсом. Если пуст — копируем уже скачанный logo-файл с диска
# (на старте проекта favicon=logo, не дёргаем внешний URL дважды). runtime-
# config.service.applyFavicon() подменит <link rel="icon"> на клиенте.
FAVICON_URL=$(node -e "const b=JSON.parse(require('fs').readFileSync('${BRAND_JSON_PATH}','utf8'));process.stdout.write(b.favicon_url||'')")
FAVICON_LOCAL=""
FAVICON_PATH=""
FAVICON_EXT=""
if [ -n "${FAVICON_URL}" ]; then
  FAVICON_EXT=$(node -e "const u='${FAVICON_URL}'.toLowerCase();const m=u.match(/\.(png|jpg|jpeg|svg|webp|ico)(?:[?#]|$)/);process.stdout.write(m?m[1]:'png')")
  FAVICON_LOCAL="/assets/favicon.${FAVICON_EXT}"
  FAVICON_PATH="${ASSETS_DIR}/favicon.${FAVICON_EXT}"
  echo "fetching favicon: ${FAVICON_URL} -> ${FAVICON_PATH}"
  if fetch_to "${FAVICON_URL}" "${FAVICON_PATH}"; then
    :
  else
    echo "WARN: cannot fetch favicon from ${FAVICON_URL}; keeping original brand.favicon_url"
    FAVICON_LOCAL=""
    FAVICON_PATH=""
  fi
elif [ -n "${LOGO_PATH}" ]; then
  FAVICON_EXT="${LOGO_EXT}"
  FAVICON_LOCAL="/assets/favicon.${FAVICON_EXT}"
  FAVICON_PATH="${ASSETS_DIR}/favicon.${FAVICON_EXT}"
  echo "favicon_url пуст — копирую logo -> ${FAVICON_PATH}"
  cp "${LOGO_PATH}" "${FAVICON_PATH}"
fi

# Если favicon — SVG, дополнительно растеризуем в PNG 256×256. Safari/iOS
# игнорируют SVG-favicon, а apple-touch-icon — PNG-only. runtime-config.service
# на клиенте добавляет оба <link>. @resvg/resvg-js установлен в /app/node_modules.
FAVICON_PNG_LOCAL=""
if [ -n "${FAVICON_PATH}" ] && [ "${FAVICON_EXT}" = "svg" ]; then
  PNG_PATH="${ASSETS_DIR}/favicon.png"
  echo "rasterize favicon: ${FAVICON_PATH} -> ${PNG_PATH}"
  if (cd /app && node -e "
    const fs=require('fs');
    const {Resvg}=require('@resvg/resvg-js');
    const svg=fs.readFileSync('${FAVICON_PATH}','utf8');
    const r=new Resvg(svg,{fitTo:{mode:'width',value:256},background:'rgba(0,0,0,0)'});
    fs.writeFileSync('${PNG_PATH}', r.render().asPng());
  "); then
    FAVICON_PNG_LOCAL="/assets/favicon.png"
  else
    echo "WARN: cannot rasterize ${FAVICON_PATH}; Safari увидит дефолтный favicon"
  fi
fi

# runtime-config.js — bundles brand-json целиком + технические настройки.
# Если лого/фавикон успешно скачаны — подменяем brand.logo_url / brand.favicon_url
# на локальные пути.
# CHATWOOT_HOST — онлайн-чат поддержки web-версии: домен НАШЕГО чат-прокси
# cc-gochatwoot (https://chat.<домен>), с него грузится widget.js. В Mini App
# не используется; пустое значение = чат выключен, профиль показывает ссылку
# на TG-бота из brand.support_bot_url.
APP_CONFIG_JSON=$(API_BASE_URL_V="${API_BASE_URL:-/api/v1}" CHATWOOT_HOST_V="${CHATWOOT_HOST:-}" LOGO_LOCAL="${LOGO_LOCAL}" FAVICON_LOCAL="${FAVICON_LOCAL}" FAVICON_PNG_LOCAL="${FAVICON_PNG_LOCAL}" node -e "
  const b=JSON.parse(require('fs').readFileSync('${BRAND_JSON_PATH}','utf8'));
  if (process.env.LOGO_LOCAL) b.logo_url = process.env.LOGO_LOCAL;
  if (process.env.FAVICON_LOCAL) b.favicon_url = process.env.FAVICON_LOCAL;
  if (process.env.FAVICON_PNG_LOCAL) b.favicon_png_url = process.env.FAVICON_PNG_LOCAL;
  const chatwoot={host: process.env.CHATWOOT_HOST_V||''};
  process.stdout.write(JSON.stringify({apiBaseUrl: process.env.API_BASE_URL_V, brand: b, chatwoot}, null, 2));
")
# Inline-bootstrap в <head>, до парсинга <body>:
#   1. Ставит CSS-переменные --color-* и --brand-logo на <html> — splash в
#      index.html сразу красится в брендовые цвета и показывает правильный
#      логотип, никакого «вспышки defaults → brand».
#   2. Ставит <link rel="icon"> с правильным URL — иначе браузер успеет
#      показать дефолтный favicon и подменить его.
#   3. Ставит <link rel="preload" as="image"> на logo_url — кэширует лого
#      для back-bar и т.д. до bootstrap'а Angular.
# Дублирует RuntimeConfigService.applyFavicon / applyThemeFromConfig
# (они остаются как fallback на dev-режиме без entrypoint'а; флаг
# data-favicon-applied=1 сигналит сервису skip).
cat > "${CONFIG_JS}" <<EOF
window.__APP_CONFIG__ = ${APP_CONFIG_JSON};
(function(){
  var cfg=window.__APP_CONFIG__||{};
  var b=cfg.brand||{};
  var root=document.documentElement;
  var head=document.head;
  // --- theme + logo CSS vars (splash читает их до Angular bootstrap'a) ---
  var colors=b.colors||{};
  Object.keys(colors).forEach(function(k){
    if(colors[k]) root.style.setProperty('--color-'+k.replace(/_/g,'-'), colors[k]);
  });
  var logoUrl=(b.logo_url||'').trim();
  if(logoUrl){
    root.style.setProperty('--brand-logo', 'url("'+logoUrl.replace(/"/g,'\\\\"')+'")');
  }
  // --- document title + meta description (из service_name) ---
  var svcName=(b.service_name||'').trim();
  if(svcName){
    document.title=svcName;
    var desc=svcName+' — выпуск виртуальных карт и пополнения для оплаты зарубежных сервисов';
    var md=head.querySelector('meta[name="description"]');
    if(!md){md=document.createElement('meta');md.setAttribute('name','description');head.appendChild(md);}
    md.setAttribute('content',desc);
  }
  // --- favicon ---
  function addLink(rel,href,type,as){var l=document.createElement('link');l.rel=rel;l.href=href;if(type)l.type=type;if(as)l.as=as;head.appendChild(l);}
  function mimeFor(u){var m=u.toLowerCase().match(/\\.(png|jpg|jpeg|svg|webp|ico)(?:[?#]|\$)/);if(!m) return undefined;var t=m[1];return t==='svg'?'image/svg+xml':t==='ico'?'image/x-icon':'image/'+(t==='jpg'?'jpeg':t);}
  var url=(b.favicon_url||b.logo_url||'').trim();
  if(url){
    var pngFallback=(b.favicon_png_url||'').trim();
    var isSvg=/\\.svg(?:[?#]|\$)/i.test(url);
    head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(function(el){el.remove();});
    addLink('icon',url,mimeFor(url));
    if(isSvg&&pngFallback){addLink('icon',pngFallback,'image/png');addLink('apple-touch-icon',pngFallback);}
    else if(!isSvg){addLink('apple-touch-icon',url);}
    head.setAttribute('data-favicon-applied','1');
  }
  if(logoUrl){addLink('preload',logoUrl,mimeFor(logoUrl),'image');}
})();
EOF

exec "$@"
