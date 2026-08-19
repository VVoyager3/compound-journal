FROM node:22.18-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json ./
COPY public ./public
COPY src ./src
COPY design-assets ./design-assets
RUN npm run build

FROM node:22.18-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
WORKDIR /app
COPY server.mjs ./
COPY src/analysis-contract.ts ./src/analysis-contract.ts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "server.mjs"]
