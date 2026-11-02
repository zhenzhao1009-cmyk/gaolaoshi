#!/bin/bash
# 把一段"花苞→盛开"的视频拆成带透明通道的序列帧：
#   每帧两张图：0001.jpg（颜色）+ 0001.png（透明度遮罩）
#   页面把两张合起来，花就能干净地放在任何底色上
#
# 背景会自动抠掉：黑底、米色宣纸、灰色纸都行，只要背景颜色比较均匀。
# 原理见 key_paper.py：按色调和亮度找背景，再只把和画面边缘连通的部分当背景，
# 花瓣里和背景颜色接近的晕染不会被挖掉。
#
# 用法：./make_frames.sh 视频文件 花的英文名 [帧数] [裁剪区域]
#   帧数      默认 120
#   裁剪区域  宽:高:左上角x:左上角y，默认整个画面
# 例子：
#   ./make_frames.sh ~/Downloads/lily.mp4 lily
#   ./make_frames.sh ~/Downloads/lotus.mov lotus 120 1520:1080:120:420
#
# 可调的环境变量：
#   PRE="drawbox=..."         裁剪前先跑的滤镜，比如用背景色涂掉水印：
#                             PRE="drawbox=x=60:y=50:w=290:h=95:t=fill:color=black"
#   WIDTH=1140                输出图片宽度
#   FEATHER="0.06 0.04 0.10"  左右 / 上 / 下 边缘淡出的比例（画面被截断的地方用）
#   NOKEY=1                   不抠图：花和纸底颜色太接近时用（比如白山茶配米色纸）。
#                             整个画面连纸一起保留，四周用椭圆渐隐融进页面
#   MIX="1.03 1.04 1.04"      不抠图时，把视频纸色的 R G B 分别乘上这些系数，调成和页面一样
set -e
IN="$1"; NAME="$2"; N="${3:-120}"; CROP="$4"
if [ -z "$IN" ] || [ -z "$NAME" ]; then
  echo "用法：./make_frames.sh 视频文件 花的英文名 [帧数] [宽:高:x:y]"; exit 1
fi
WIDTH="${WIDTH:-1140}"
read FX FT FB <<< "${FEATHER:-0.06 0.04 0.10}"
case "$IN" in /*) ;; *) IN="$(pwd)/$IN" ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
# 脚本可以放在项目根目录，也可以放在 tools/ 子文件夹里
if [ -f "$HERE/index.html" ]; then ROOT="$HERE"; else ROOT="$(dirname "$HERE")"; fi
cd "$ROOT"
OUT="frames/$NAME"
rm -rf "$OUT"; mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

read VW VH <<< "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$IN" | tr x ' ')"
if [ -z "$CROP" ]; then CROP="$VW:$VH:0:0"; fi
IFS=: read CW CH CX CY <<< "$CROP"
CROPF="crop=$CW:$CH:$CX:$CY"
[ -n "$PRE" ] && CROPF="$PRE,$CROPF"
OH=$(( WIDTH * CH / CW / 2 * 2 ))

# 边缘淡出遮罩：中间全白，四边渐黑
ffmpeg -v error -y -f lavfi -i "color=black:s=${WIDTH}x${OH}:d=1,format=gray" \
  -vf "geq=lum='255*clip(min(min(X/(W*$FX),(W-X)/(W*$FX)),min(Y/(H*$FT),(H-Y)/(H*$FB))),0,1)'" \
  -frames:v 1 "$TMP/feather.png"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
FPS=$(python3 -c "print($N / $DUR)")

if [ "$NOKEY" = 1 ]; then
  # 不抠图：颜色帧做纸色校正，遮罩就是一个居中的椭圆渐隐
  read MR MG MB <<< "${MIX:-1 1 1}"
  ffmpeg -v error -i "$IN" -vf "fps=$FPS,$CROPF,scale=$WIDTH:$OH,colorchannelmixer=rr=$MR:gg=$MG:bb=$MB" \
    -frames:v "$N" -q:v 3 "$OUT/%04d.jpg"
  ffmpeg -v error -y -f lavfi -i "color=black:s=${WIDTH}x${OH}:d=1,format=gray" \
    -vf "geq=lum='255*clip((1-hypot((X-W*0.5)/(W*0.5),(Y-H*0.47)/(H*0.53)))/0.42,0,1)'" \
    -frames:v 1 "$TMP/ellipse.png"
  for f in "$OUT"/*.jpg; do
    ffmpeg -v error -y -i "$TMP/ellipse.png" -i "$TMP/feather.png" -filter_complex \
      "[0][1]blend=all_mode=multiply,format=gray,split[a1][a2];[a1]lutyuv=y=0[z];[z][a2]alphamerge,format=ya8" \
      "${f%.jpg}.png"
    break
  done
  # 每一帧遮罩都一样，复制即可
  for f in "$OUT"/*.jpg; do cp "$OUT/0001.png" "${f%.jpg}.png" 2>/dev/null || true; done
  COUNT=$(ls "$OUT"/*.jpg | wc -l | tr -d ' ')
  echo "完成：$OUT 共 $COUNT 帧（$(du -sh "$OUT" | cut -f1)），未抠图"
  echo "  frames: { dir: \"$OUT\", count: $COUNT },"
  exit 0
fi

# 1. 在小尺寸上算出每帧的抠图遮罩
KW=720; KH=$(( KW * CH / CW / 2 * 2 ))
python3 "$HERE/key_paper.py" "$IN" "fps=$FPS,$CROPF,scale=$KW:$KH:flags=area" $KW $KH "$TMP/key.raw"

# 2. 颜色帧（jpg）
ffmpeg -v error -i "$IN" -vf "fps=$FPS,$CROPF,scale=$WIDTH:$OH" \
  -frames:v "$N" -q:v 3 "$OUT/%04d.jpg"

# 3. 透明度遮罩（png）：抠图遮罩放大、柔化、稍微收一点边，再乘上边缘淡出
ffmpeg -v error -f rawvideo -pix_fmt gray -video_size ${KW}x${KH} -framerate "$FPS" -i "$TMP/key.raw" \
  -loop 1 -i "$TMP/feather.png" -filter_complex \
  "[0:v]scale=$WIDTH:$OH:flags=bicubic,erosion,gblur=sigma=1.4,format=gray[k];
   [1:v]format=gray[f];
   [k][f]blend=all_mode=multiply:shortest=1,split[a1][a2];
   [a1]lutyuv=y=0[zero];
   [zero][a2]alphamerge,format=ya8" \
  -frames:v "$N" "$OUT/%04d.png"

COUNT=$(ls "$OUT"/*.jpg | wc -l | tr -d ' ')
echo "完成：$OUT 共 $COUNT 帧（$(du -sh "$OUT" | cut -f1)）"
echo "在 index.html 的 FLOWERS 里给这朵花加上："
echo "  frames: { dir: \"$OUT\", count: $COUNT },"
