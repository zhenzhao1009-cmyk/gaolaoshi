# 实时 3D 花卉模型

五个 GLB 文件均包含实际三角网格、法线、顶点色、五个开合形变目标与开合动画，不含图片或图片纹理。每朵花都带叶片网格（荷花、樱花此前缺失，现已补齐）。

- lotus.glb：荷花
- lily.glb：百合
- rose.glb：玫瑰
- camellia.glb：山茶
- sakura.glb：樱花

可导入 Blender 或其他 glTF 2.0 工具，从任意角度检查。页面以相同的程序化网格在 WebGL2 中实时渲染。

重新导出：node tools/export_models.mjs。校验：node tools/test_models.mjs。
