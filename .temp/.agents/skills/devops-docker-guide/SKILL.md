---
name: devops-docker-guide
description: "Use when working with Docker: creating Dockerfiles, configuring Docker Compose services, managing containers/volumes/networks, debugging container issues, or orchestrating multi-service stacks."
---

# Docker

## Follow this workflow

- Identify the task scope: single container, multi-service Compose stack, or debugging.
- Choose the right base image for the use case (Alpine for minimal, slim for balanced, full for compatibility).
- Order Dockerfile instructions by change frequency to maximize layer cache hits.
- Use Docker Compose for all multi-service setups; avoid ad-hoc `docker run` chains in production.
- Apply health checks to every long-running service.
- Test with `docker compose config` to validate YAML before running.

## Use this quick start

```bash
# Build image
docker build -t app:local .

# Start full stack
docker compose up -d --build

# Validate service health
docker compose ps
docker compose logs -f app

# Stop stack
docker compose down
```

## Core concepts

**Images vs Containers:**
- Image: read-only template with code, runtime, and dependencies.
- Container: running instance of an image with a writable layer.
- Registry: image storage (Docker Hub, GHCR, private registries).

**Volumes:**
```bash
docker run -v named_volume:/app/data image   # Named volume (persists)
docker run -v $(pwd)/data:/app/data image    # Bind mount (host path)
```

**Networks:**
```bash
docker network create mynet
docker run --network mynet --name db postgres
docker run --network mynet --name app myapp  # 'app' reaches 'db' by hostname
```

## Dockerfile essentials

Order layers from least to most frequently changed:

```dockerfile
FROM php:8.0-fpm-alpine

# 1. System deps (rarely change)
RUN apk add --no-cache libpng-dev && docker-php-ext-install pdo_mysql gd

# 2. App dependencies (change occasionally)
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist

# 3. Application code (changes frequently)
COPY . .

# 4. Runtime config
EXPOSE 9000
USER www-data
CMD ["php-fpm"]
```

**Key instructions:**
| Instruction | Purpose |
|---|---|
| `FROM image:tag` | Base image – always pin a version |
| `WORKDIR /path` | Set working directory |
| `COPY src dst` | Copy files (use before RUN for cache) |
| `RUN cmd1 && cmd2` | Combine related commands into one layer |
| `ENV KEY=value` | Runtime environment variable |
| `ARG NAME=default` | Build-time variable |
| `EXPOSE port` | Document exposed port |
| `HEALTHCHECK CMD …` | Container health probe |
| `USER username` | Drop root privileges |
| `CMD ["exec"]` | Default command (exec form, not shell form) |

**Multi-stage build pattern:**
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage (only runtime artifacts)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

## Docker Compose essentials

```yaml
# compose.yml (no version field needed in Compose v2.40+)
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - APP_ENV=local
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./src:/app/src
    restart: unless-stopped

  db:
    image: mysql:8-alpine
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: ${DB_DATABASE}
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

**Essential Compose commands:**
```bash
docker compose up -d               # Start all services (detached)
docker compose up --build          # Rebuild images before starting
docker compose down                # Stop and remove containers
docker compose down -v             # Also remove volumes
docker compose logs -f service     # Stream logs for one service
docker compose exec service sh     # Shell into running container
docker compose run --rm service cmd # One-off command in new container
docker compose ps                  # List service status
docker compose config              # Validate and print merged config
```

## Working with containers

```bash
# Lifecycle
docker build -t name:tag .
docker run -d --name app -p 8080:80 name:tag
docker stop app && docker rm app

# Inspection
docker logs -f app
docker exec -it app /bin/sh
docker inspect app
docker stats                        # Real-time CPU/memory

# Cleanup
docker system prune -a              # Remove all unused resources
docker volume prune                 # Remove unused volumes
docker image prune                  # Remove dangling images
```

## Enforce these rules

- Always pin base image versions: use `php:8.0-fpm-alpine`, never `php:latest`.
- Always run containers as a non-root user; add `USER` instruction before `CMD`.
- Always combine `apt-get update && apt-get install` with cleanup in one `RUN` layer.
- Never embed secrets in Dockerfiles or images; use environment variables or Docker secrets.
- Never use `docker-compose` (v1); use `docker compose` (v2 plugin).
- Always include `.dockerignore` to exclude `vendor/`, `node_modules/`, `.git/`, `.env`.

## Verify results

- Build validation passes with `docker build -t app:local .`.
- Compose syntax validation passes with `docker compose config`.
- Runtime smoke test passes with `docker compose up -d && docker compose ps && docker compose logs --tail 50 app`.
- Debug workflow is executable with `docker logs`, `docker inspect`, `docker exec`, `docker network inspect`, and `docker system prune`.
- Reference coverage is complete: build patterns, orchestration, and debugging.
- Guidance remains implementation/diagnosis focused and does not include production hardening policy.

## Quick diagnostics

```bash
# Container won't start
docker logs container_name
docker inspect -f '{{.State.ExitCode}}' container_name
docker run -it --entrypoint /bin/sh image_name    # Override entrypoint to debug

# Volume appears empty
docker inspect -f '{{.Mounts}}' container_name

# Port already in use
lsof -i :PORT && kill -9 <PID>

# Build context too large
du -sh . && cat .dockerignore

# Out of disk space
docker system df && docker system prune -a --volumes
```

## Read this reference when needed

- `.agents/skills/devops-docker-guide/references/dockerfile-patterns.md` — multi-stage builds, framework-specific Dockerfiles (PHP/Laravel, Node.js, Python)
- `.agents/skills/devops-docker-guide/references/compose-orchestration.md` — full-stack Compose examples, network isolation, named volumes, Swarm mode
- `.agents/skills/devops-docker-guide/references/debugging-techniques.md` — container debugging techniques, network diagnosis, resource monitoring

## Consult related skills

- `devops-docker-best-practices` — image optimization, runtime security, production checklists, 2025 features
