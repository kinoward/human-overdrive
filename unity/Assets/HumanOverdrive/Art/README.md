# Unity 美术源文件

本目录保存已取得的开放美术资源与中文字体，尚未完成 Unity 材质、预制体或场景配置。

- `Textures/Asphalt02/`：Poly Haven 沥青，2K 漫反射、OpenGL 法线与粗糙度；物理尺度约 3 米 × 3 米。
- `Textures/ConcreteWall006/`：Poly Haven 混凝土，2K 漫反射、OpenGL 法线与粗糙度；物理尺度约 2 米 × 2 米。
- `Environment/venice_sunset_2k.hdr`：Poly Haven 日落环境光，供天空和反射使用，不表示北京实景。
- `Fonts/SourceHanSansCN-Regular.otf`：Adobe 思源黑体简体中文常规字重，供中文界面使用。
- `SOURCES.json`：作者、原始资源页面、下载地址、文件大小、许可和字体固定提交。
- `Licenses/CC0-1.0.txt`、`Fonts/OFL.txt`：随资源保留的完整许可正文。

贴图和 HDR 均为官方源文件，没有重新压缩或修改。法线使用 OpenGL 约定；粗糙度为原始 Roughness，后续在 Unity 中按实际渲染管线配置，避免与 Smoothness 混用。

许可和来源汇总见仓库根目录的 `ASSET_LICENSES.md`。文件取得不等同于已在 Unity 中显示，不在此记录未执行的运行验证。
