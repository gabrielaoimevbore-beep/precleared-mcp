# Runs Precleared's hosted MCP server over stdio for clients that cannot speak streamable HTTP directly.
# The real server lives at https://precleared.dev/mcp; this image is a thin bridge using mcp-remote.
FROM node:20-alpine
RUN npm install -g mcp-remote
ENV PRECLEARED_URL=https://precleared.dev/mcp
# Optional: pass an API key with -e PRECLEARED_API_KEY=pc_live_... for 25 checks a day and prepaid packs.
ENTRYPOINT ["sh", "-c", "if [ -n \"$PRECLEARED_API_KEY\" ]; then exec mcp-remote \"$PRECLEARED_URL\" --transport http-only --header \"Authorization: Bearer $PRECLEARED_API_KEY\"; else exec mcp-remote \"$PRECLEARED_URL\" --transport http-only; fi"]
