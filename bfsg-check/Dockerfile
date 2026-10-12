# Produktions-Image mit Chromium (Playwright-Basis-Image enthält alle Systembibliotheken).
# Version an playwright-core in package.json anpassen (hier: 1.64.x).
FROM mcr.microsoft.com/playwright:v1.64.0-noble AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Unterpfad zur Build-Zeit festlegen (leer = Root). Für gdprgard.eu/bfsg-check:
#   docker build --build-arg NEXT_PUBLIC_BASE_PATH=/bfsg-check .
ARG NEXT_PUBLIC_BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Nicht als root laufen. Falls Chromium im Container keine Sandbox starten kann,
# BFSG_CHROMIUM_NO_SANDBOX=1 setzen UND Egress per Firewall auf das Internet beschränken.
USER pwuser
EXPOSE 3000
CMD ["node", "server.js"]
