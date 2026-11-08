FROM alpine:3.20

RUN apk add --no-cache ca-certificates \
    && addgroup -S contextllm \
    && adduser -S -G contextllm contextllm

WORKDIR /app

ARG TARGETARCH
COPY dist/context_llm_linux_${TARGETARCH} /app/context-LLM
RUN chown -R contextllm:contextllm /app

USER contextllm
ENTRYPOINT ["/app/context-LLM"]
