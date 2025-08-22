FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    bash curl git build-essential pkg-config \
    python3-venv python3-pip \
    poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspaces/ai-answer
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=development