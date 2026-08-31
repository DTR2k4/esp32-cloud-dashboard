FROM node:20-alpine

WORKDIR /app

# Cài dependency trước, tách riêng khỏi COPY code — Docker cache layer này lại,
# nên sau này sửa code (không đổi package.json) rebuild sẽ nhanh hơn nhiều.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server/index.js"]
