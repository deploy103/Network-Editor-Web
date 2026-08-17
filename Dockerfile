# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
RUN npm ci --workspace web
COPY web ./web
ARG VITE_API_URL=/
ARG VITE_CLI_ENGINE_URL=
ENV VITE_API_URL=${VITE_API_URL} VITE_CLI_ENGINE_URL=${VITE_CLI_ENGINE_URL}
RUN npm run build --workspace web

FROM golang:1.23-alpine AS api-build
WORKDIR /src
COPY server-go/go.mod server-go/go.sum ./
RUN go mod download
COPY server-go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/network-editor-api ./cmd/api

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

FROM alpine:3.21 AS api
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app
COPY --from=api-build /out/network-editor-api /usr/local/bin/network-editor-api
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/network-editor-api"]
