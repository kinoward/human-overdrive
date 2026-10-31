# 网页美术源文件

本目录保存 Three.js 网页可复用的开放美术资源与中文字体，原始来源和许可随文件保留，接入状态以项目架构与执行计划为准。

- `Textures/Asphalt02/`：Poly Haven 沥青，2K 漫反射、OpenGL 法线与粗糙度；物理尺度约 3 米 × 3 米，原始 JPG／PNG 与运行用 WebP 同时保留。
- `Textures/ConcreteWall006/`：Poly Haven 混凝土，2K 漫反射、OpenGL 法线与粗糙度；物理尺度约 2 米 × 2 米，原始 JPG／PNG 与运行用 WebP 同时保留。
- `Environment/venice_sunset_2k.hdr`：Poly Haven 日落环境光，供天空和反射使用，不表示北京实景。
- `Fonts/SourceHanSansCN-Regular.otf`：Adobe 思源黑体简体中文常规字重原始文件。
- `Fonts/OverdriveScene-Regular.woff2`：供场景路牌、店招与霓虹文字使用的字体子集，内部字体族为 `Overdrive Scene`；保留原始版权与 OFL。
- `SOURCES.json`：作者、原始资源页面、下载地址、文件大小、许可和字体固定提交。
- `Licenses/CC0-1.0.txt`、`Fonts/OFL.txt`：随资源保留的完整许可正文。

原始贴图和 HDR 均为官方源文件。底色贴图使用 sRGB；OpenGL 法线与原始 Roughness 按非颜色数据读取。重复路面贴图需要米制 UV 与正确物理尺度，HDR 源文件保留供后续复用。

## 启动资源衍生版本

六张运行贴图均保持 2048×2048：底色采用 WebP 质量 90、粗糙度采用质量 95，两者使用 `-m 6 -sharp_yuv`；法线采用 `-near_lossless 60 -m 6`，无色度抽样，保留 OpenGL 分量。本批法线相对浏览器使用的源图 8 位通道最大误差为 2/255，沥青／混凝土 RMSE 分别为 1.2297／1.2311。混凝土源 PNG 为 16 位，衍生图按网页纹理使用的 8 位通道保存。

字体子集包含 `src/**/*.ts`、`src/**/*.css` 与道路 JSON 中原字体支持的全部字符，另保留 ASCII、全角标点、全角空格和向上箭头。字体族、完整名、PostScript 名与 CFF 内部名称改为 `Overdrive` 名称，原始版权与许可信息保留。当前版本为 1021 个 Unicode 映射、1357 个字形，源字体支持的请求字符没有遗漏；场景文字变化后需重新生成子集。

本批六张贴图加字体由约 50.57 MB 缩小至约 16.53 MB，减少约 67.3%；源文件不删除。字体由约 8.43 MB 缩小至约 177 KB。每个衍生文件的输入、输出大小与参数记录在 `SOURCES.json`。

复现时先在独立工具环境安装 `cwebp 1.6.0`、`fontTools 4.68.0` 与 `Brotli 1.2.1`，在仓库根目录执行 `python scripts/prepare-startup-assets.py`。只更新场景文字时执行 `python scripts/prepare-startup-assets.py --font-only`；命令同步更新 `SOURCES.json` 中对应的衍生文件记录，不修改原始文件。

许可和来源汇总见仓库根目录的 `ASSET_LICENSES.md`。源文件存在不等同于已在浏览器中正确显示，不在此记录未执行的运行验证。
