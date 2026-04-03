FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/

ENV TRANSPORT=http
ENV PORT=3456
ENV CLAUDE_DATA_PATH=/data/.claude
ENV CLAUDE_PROJECTS_DIR=/data/sites

EXPOSE 3456

CMD ["node", "dist/index.js"]
