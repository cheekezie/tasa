#!/bin/sh
# Starts the given API and web images and waits until the API is healthy.
#   ./deploy.sh <tag>                 (GitHub Actions runs this after pushing both images)
#   ./deploy.sh <older-commit-sha>    (roll back)
# Image names come from .env (API_IMAGE, WEB_IMAGE). The admin's files are copied into ./admin first.
set -eu
cd "$(dirname "$0")"
TAG="${1:?usage: deploy.sh <tag>}"

# Remember the tags in .env so a reboot or `docker compose up` starts the same images.
touch .env
grep -v -e '^API_TAG=' -e '^WEB_TAG=' .env > .env.next || true
printf 'API_TAG=%s\nWEB_TAG=%s\n' "$TAG" "$TAG" >> .env.next
mv .env.next .env

docker compose pull api web
docker compose up -d --remove-orphans

echo "Waiting for the API to report healthy…"
i=0
while [ $i -lt 60 ]; do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo starting)
  if [ "$status" = healthy ]; then
    docker image prune -f >/dev/null
    echo "Tasa $TAG is live."
    exit 0
  fi
  i=$((i + 1))
  sleep 3
done

echo "API $TAG did not become healthy. Last logs:"
docker compose logs --tail 80 api
exit 1
