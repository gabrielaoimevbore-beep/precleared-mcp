# Precleared MCP server over stdio. Builds the small server in this repository (index.js),
# which fulfils contact_check and verify_receipt through the public REST API at https://precleared.dev/api/v1.
#   docker build -t precleared-mcp . && docker run -i --rm precleared-mcp
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.js ./
# Optional: -e PRECLEARED_API_KEY=pc_live_... for 25 checks a day and prepaid packs.
ENTRYPOINT ["node", "index.js"]
