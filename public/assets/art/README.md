# 网页美术源文件

本目录保存 Three.js 网页可复用的开放美术资源与中文字体，原始来源和许可随文件保留，接入状态以项目架构与执行计划为准。

- `Textures/Asphalt02/`：Poly Haven 沥青，2K 漫反射、OpenGL 法线与粗糙度；物理尺度约 3 米 × 3 米。
- `Textures/ConcreteWall006/`：Poly Haven 混凝土，2K 漫反射、OpenGL 法线与粗糙度；物理尺度约 2 米 × 2 米。
- `Environment/venice_sunset_2k.hdr`：Poly Haven 日落环境光，供天空和反射使用，不表示北京实景。
- `Fonts/SourceHanSansCN-Regular.otf`：Adobe 思源黑体简体中文常规字重，供中文界面使用。
- `SOURCES.json`：作者、原始资源页面、下载地址、文件大小、许可和字体固定提交。
- `Licenses/CC0-1.0.txt`、`Fonts/OFL.txt`：随资源保留的完整许可正文。

贴图和 HDR 均为官方源文件。底色贴图使用 sRGB；OpenGL 法线与原始 Roughness 按非颜色数据读取。重复路面贴图需要米制 UV 与正确物理尺度，HDR 供环境反射使用。

许可和来源汇总见仓库根目录的 `ASSET_LICENSES.md`。源文件存在不等同于已在浏览器中正确显示，不在此记录未执行的运行验证。
