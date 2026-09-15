# multi-stage: builder собирает бандл, runtime — nginx раздаёт статику.
# runtime-config.js инжектится в head синхронным <script>, поэтому brand/тема
# применяются до первого paint'a (см. splash в index.html).
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl nodejs npm
WORKDIR /app
# Сам бандл — в стандартный nginx-html. Кладём отдельно node_modules —
# entrypoint использует @resvg/resvg-js для растеризации SVG-favicon.
COPY --from=builder /app/dist/hochuplachu-frontend/browser /usr/share/nginx/html
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package.json /app/package.json
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
