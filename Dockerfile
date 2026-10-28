# =============================================================================
# Multi-Stage Root Dockerfile for Arc-Stream (ML Service, Node Gateway, Client)
# =============================================================================

# ─── Target 1: ML Service (FastAPI + PyTorch LSTM + pgvector) ────────────────
FROM python:3.11-slim AS ml-service

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /code

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY ml-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY ml-service/app /code/app
COPY database /code/database

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]


# ─── Target 2: Node.js Express Gateway & Spotify Auth Server ─────────────────
FROM node:20-alpine AS server

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server/ ./
COPY database/ ./database/

EXPOSE 3000

CMD ["node", "server.js"]


# ─── Target 3: React + Vite Frontend Build ───────────────────────────────────
FROM node:20-alpine AS client-build

WORKDIR /app

COPY client/package*.json ./
RUN npm ci || npm install

COPY client/ ./

ARG VITE_NODE_BASE=http://127.0.0.1:3000
ENV VITE_NODE_BASE=$VITE_NODE_BASE

RUN npm run build


# ─── Target 4: Frontend Production Nginx Server (Default Final Stage) ────────
FROM nginx:1.27-alpine AS client

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
