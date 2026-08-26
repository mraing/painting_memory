#!/bin/sh
# 启动绘忆立绘转换后端（FastAPI + OpenCV）。
# 用法：./start.sh （等价于 .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000）
# 首次使用前先安装依赖：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
set -e
cd "$(dirname "$0")"

# 防重复启动：8000 端口已有健康服务 → 直接提示并退出（避免 Errno 48 端口占用报错）
if curl -s -m 1 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
  echo "立绘转换后端已在运行（http://127.0.0.1:8000/api/health OK）。"
  echo "如需重启：pkill -f 'uvicorn app:app' 后再运行 ./start.sh"
  exit 0
fi

exec .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
