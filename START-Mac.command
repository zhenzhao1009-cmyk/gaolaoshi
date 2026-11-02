#!/bin/bash
# 双击运行：在本机起一个小服务器，并用 Chrome 打开页面
cd "$(dirname "$0")"
PORT=8765
echo "指尖花开 正在运行： http://localhost:$PORT"
echo "关掉这个窗口就停止。"
(sleep 1 && open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT") &
python3 tools/serve.py --port "$PORT"
