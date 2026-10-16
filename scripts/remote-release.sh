#!/usr/bin/env bash
# 在部署目标上执行。GitHub Actions 先把本文件拷过去再调用。
# prepare <目录> <账号>：确认 calmobile.service 已经存在，备份 dist，准备可写目录。不创建单元。
# finish <目录> <环境文件>：安装 /etc/calmobile.env，安装依赖，迁移，重启。
set -euo pipefail

phase="${1:-}"
path="${2:-}"

if [[ ! "$path" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "部署目录不合法" >&2
  exit 1
fi

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

require_sudo() {
  if [ "$(id -u)" -ne 0 ] && ! sudo -n true; then
    echo "部署账号不是 root，而且不能免密 sudo。写 /etc/calmobile.env 和重启 calmobile 需要其中一种。" >&2
    exit 1
  fi
}

require_unit() {
  if ! as_root systemctl cat calmobile.service >/dev/null 2>&1; then
    echo "没有找到 systemd 单元 calmobile.service。这次部署不会创建它。" >&2
    echo "单元需要 EnvironmentFile=/etc/calmobile.env，WorkingDirectory=${path}/server，启动命令带 --production。" >&2
    exit 1
  fi
  local unit
  unit="$(as_root systemctl cat calmobile.service)"
  if ! grep -F -x "EnvironmentFile=/etc/calmobile.env" <<<"$unit" \
    && ! grep -F -x "EnvironmentFile=-/etc/calmobile.env" <<<"$unit"; then
    echo "calmobile.service 必须包含 EnvironmentFile=/etc/calmobile.env。" >&2
    exit 1
  fi
  if ! grep -F -x "WorkingDirectory=${path}/server" <<<"$unit"; then
    echo "calmobile.service 的 WorkingDirectory 必须是 ${path}/server。" >&2
    exit 1
  fi
  if ! grep -q -- '--production' <<<"$unit"; then
    echo "calmobile.service 的启动命令必须带 --production。" >&2
    exit 1
  fi
}

case "$phase" in
  prepare)
    account="${3:-}"
    if [[ ! "$account" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
      echo "部署账号不合法" >&2
      exit 1
    fi
    require_sudo
    require_unit
    command -v node >/dev/null || { echo "服务器上没有 node。" >&2; exit 1; }
    command -v pnpm >/dev/null || { echo "服务器上没有 pnpm。" >&2; exit 1; }
    as_root mkdir -p "$path/server" "$path/web"
    as_root chown "$account:$account" "$path" "$path/server" "$path/web"
    if [ -d "$path/server/dist" ]; then
      as_root rm -rf "$path/server/dist.prev"
      as_root cp -a "$path/server/dist" "$path/server/dist.prev"
      as_root chown -R "$account:$account" "$path/server/dist" "$path/server/dist.prev"
    fi
    if [ -d "$path/web/dist-join" ]; then
      as_root chown -R "$account:$account" "$path/web/dist-join"
    fi
    if [ -d "$path/web/dist" ]; then
      as_root chown -R "$account:$account" "$path/web/dist"
    fi
    ;;
  finish)
    src="${3:-}"
    require_sudo
    require_unit
    if [ ! -f "$src" ]; then
      echo "没有找到待安装的环境文件。" >&2
      exit 1
    fi
    node_bin="$(command -v node)"
    as_root install -m 600 -o root -g root "$src" /etc/calmobile.env
    rm -f "$src"
    cd "$path/server"
    pnpm install --frozen-lockfile --prod
    as_root bash -c 'cd "$1" && exec env DOTENV_CONFIG_PATH=/etc/calmobile.env DOTENV_CONFIG_QUIET=true "$2" dist/config/migrate.js migrate --production' bash "$path/server" "$node_bin"
    as_root systemctl restart calmobile.service
    sleep 2
    state="$(as_root systemctl is-active calmobile.service || true)"
    if [ "$state" != "active" ]; then
      echo "calmobile.service 没有进入运行状态（${state}）。" >&2
      as_root systemctl status calmobile.service --no-pager --lines=20 || true
      exit 1
    fi
    ;;
  *)
    echo "用法：remote-release.sh prepare|finish <目录> ..." >&2
    exit 2
    ;;
esac
