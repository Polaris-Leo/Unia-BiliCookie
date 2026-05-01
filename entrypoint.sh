#!/bin/sh
# 修复 bind mount 时宿主机目录与容器用户的权限不匹配问题
# 以 root 身份将 /app/data 的所有权移交给 appuser，然后降权运行
set -e

DATA_DIR=/app/data
mkdir -p "$DATA_DIR"
chown -R appuser:appgroup "$DATA_DIR"

exec su-exec appuser "$@"
