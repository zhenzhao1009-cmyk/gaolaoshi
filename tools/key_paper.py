"""
给浅色纸底的视频生成抠图遮罩（工笔画的米色 / 灰色纸）。

思路：
1. 先按"色调 + 亮度"和纸的差别算出每个像素像不像纸；
2. 再从画面边缘往里找：只有和边缘连通的纸色区域才算背景。
   工笔画花瓣都有轮廓线，花瓣内部被误判的浅色晕染会被轮廓围住，
   所以不会被当成背景挖掉。

输出：每帧一张灰度遮罩（白 = 保留，黑 = 背景），连续写进一个 raw 文件，
由 make_frames.sh 接着用。

用法：python3 key_paper.py 视频 "fps=..,crop=..,scale=W:H" W H 输出文件
"""
import math
import subprocess
import sys
from collections import deque

video, chain, W, H, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
T0, TW = 10.0, 12.0          # 离纸色多远开始算花、多宽的过渡
HOLE_MAX = W * H * 0.015     # 被围住的区域小于画面 1.5% 才可能填成花（大的空隙还是背景）
PAPER_MEAN = 25              # 被围住的区域平均"不像纸"程度低于这个值，说明就是纸，是花瓣间的空隙

proc = subprocess.Popen(
    ["ffmpeg", "-v", "error", "-i", video, "-vf", chain, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    stdout=subprocess.PIPE,
)
N = W * H
EDGE = [i for i in range(N) if i % W in (0, 1, W - 2, W - 1) or i // W in (0, 1, H - 2, H - 1)]
frames = 0

with open(out, "wb") as f:
    while True:
        buf = proc.stdout.read(N * 3)
        if len(buf) < N * 3:
            break
        R, G, B = buf[0::3], buf[1::3], buf[2::3]

        # 每帧都用四周一圈像素的中位数估计纸的颜色（拼接视频里每段纸色可能不同）
        med = lambda xs: sorted(xs)[len(xs) // 2]
        paper = (
            med([R[i] - G[i] for i in EDGE]),
            med([G[i] - B[i] for i in EDGE]),
            med([(R[i] + G[i] + B[i]) / 3 for i in EDGE]),
        )
        if frames == 0:
            print(f"纸色估计：r-g={paper[0]} g-b={paper[1]} 亮度={paper[2]:.0f}", file=sys.stderr)
        rg0, gb0, l0 = paper

        alpha = bytearray(N)
        for i, (r, g, b) in enumerate(zip(R, G, B)):
            d0 = (r - g) - rg0
            d1 = (g - b) - gb0
            d2 = 0.5 * ((r + g + b) / 3 - l0)
            a = (math.sqrt(d0 * d0 + d1 * d1 + d2 * d2) - T0) / TW
            alpha[i] = 0 if a <= 0 else 255 if a >= 1 else int(a * 255)

        # 找出所有"不是花"的连通区域
        final = bytearray(b"\xff" * N)
        seen = bytearray(N)
        for start in range(N):
            if seen[start] or alpha[start] >= 128:
                continue
            comp = []
            touches_edge = False
            q = deque([start])
            seen[start] = 1
            while q:
                i = q.popleft()
                comp.append(i)
                x, y = i % W, i // W
                if x == 0 or y == 0 or x == W - 1 or y == H - 1:
                    touches_edge = True
                for j in (i - 1 if x > 0 else -1, i + 1 if x < W - 1 else -1, i - W, i + W):
                    if 0 <= j < N and not seen[j] and alpha[j] < 128:
                        seen[j] = 1
                        q.append(j)
            mean = sum(alpha[i] for i in comp) / len(comp)
            if touches_edge or len(comp) > HOLE_MAX or mean < PAPER_MEAN:
                for i in comp:
                    final[i] = alpha[i]   # 真背景（含花瓣之间围出来的纸）：保留柔和边缘
            # 否则是花瓣晕染被误判出的小洞：保持 255，填上

        f.write(final)
        frames += 1

proc.wait()
print(f"遮罩完成：{frames} 帧", file=sys.stderr)
