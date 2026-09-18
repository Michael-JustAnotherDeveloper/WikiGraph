FROM golang:alpine AS build

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN go build -o /app/server ./cmd/server

FROM alpine:latest
COPY --from=build /app/server .
EXPOSE 8080
CMD ["./server"]

