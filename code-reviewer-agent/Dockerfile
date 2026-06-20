FROM node:22-alpine

WORKDIR /agent

COPY package.json ./
COPY scripts ./scripts
COPY skills ./skills
COPY .ai-reviewer.json ./

RUN chmod +x /agent/scripts/ai-code-reviewer.mjs

WORKDIR /workspace

ENTRYPOINT ["node", "/agent/scripts/ai-code-reviewer.mjs"]
