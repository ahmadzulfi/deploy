# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ai-knowledge . \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/reseed ./cmd/reseed

FROM alpine:3.22
# wget bawaan alpine dipakai healthcheck di compose.
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H app
WORKDIR /app
COPY --from=build /out/ ./
# Dibaca relatif ke folder kerja oleh POST /documents/seed dan ./reseed.
COPY dummy_data.json ./
USER app
EXPOSE 8080
CMD ["./ai-knowledge"]
