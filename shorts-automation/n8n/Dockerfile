FROM docker.n8n.io/n8nio/n8n:latest
USER root
RUN apk add --no-cache ffmpeg python3 py3-pip curl font-noto-devanagari font-dejavu \
 && pip install --no-cache-dir --break-system-packages edge-tts \
 && mkdir -p /data/shorts && chown node:node /data/shorts
USER node
