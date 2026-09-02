# Só pra uso local / referência. Em produção o serviço roda como os outros
# apps Kyvvo: imagem node:20-alpine crua + bind mount + `command: sh -c "npm
# install --omit=dev --no-audit --no-fund && node index.js"` no compose
# (ver kyvvohq/kyvvo-infra), sem build de imagem.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* .npmrc ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3003

CMD ["node", "index.js"]
