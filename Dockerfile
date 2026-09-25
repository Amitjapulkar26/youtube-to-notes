FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PATH="/opt/venv/bin:${PATH}"
ENV HOST=0.0.0.0

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir yt-dlp faster-whisper \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data/notes /app/temp /app/logs

EXPOSE 3000

CMD ["npm", "start"]