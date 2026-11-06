#!/usr/bin/env bash
set -euo pipefail

release="${1:?release sha required}"
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
root=/opt/apps/telegram-channel-matrix
release_dir="$root/releases/$release"
source_dir="$release_dir/source"
image="telegram-channel-matrix:$release"

exec 9>/run/lock/telegram-channel-matrix-operation.lock
flock -n 9 || { echo 'Daily worker or another deployment is active.' >&2; exit 1; }
if systemctl is-active --quiet telegram-channel-matrix.service; then
  echo 'Daily worker is active; deployment refused.' >&2
  exit 1
fi

test -s "$release_dir/image.tar.gz"
test -f "$source_dir/compose.yml"
docker load -i "$release_dir/image.tar.gz"

old_image=""
if [[ -f "$root/release.env" ]]; then
  old_image="$(sed -n 's/^MATRIX_IMAGE=//p' "$root/release.env")"
  cp "$root/release.env" "$root/previous-release.env"
fi
printf 'MATRIX_IMAGE=%s\n' "$image" > "$root/release.env.tmp"
chmod 0600 "$root/release.env.tmp"
mv "$root/release.env.tmp" "$root/release.env"

rollback() {
  if [[ -n "$old_image" && -f "$root/previous-release.env" ]]; then
    cp "$root/previous-release.env" "$root/release.env"
  fi
}
if ! docker compose --project-directory "$root" -f "$source_dir/compose.yml" \
  --env-file "$root/.env" --env-file "$root/release.env" \
  run --rm worker node dist/src/llm-config-check.js; then
  rollback
  exit 1
fi

for directory in src dist tests scripts prompts migrations deploy; do
  if [[ -d "$source_dir/$directory" ]]; then
    rm -rf "$root/$directory"
    cp -a "$source_dir/$directory" "$root/$directory"
  fi
done
for file in compose.yml package.json package-lock.json tsconfig.json README.md; do
  if [[ -f "$source_dir/$file" ]]; then cp -a "$source_dir/$file" "$root/$file"; fi
done

sudo install -m 0644 "$root/deploy/telegram-channel-matrix.service" /etc/systemd/system/telegram-channel-matrix.service
sudo install -m 0644 "$root/deploy/telegram-channel-matrix.timer" /etc/systemd/system/telegram-channel-matrix.timer
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/telegram-channel-matrix.service /etc/systemd/system/telegram-channel-matrix.timer

echo "Installed $image; the daily timer remains independently managed."
