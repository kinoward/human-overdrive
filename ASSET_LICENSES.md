# 资产来源

## 北京道路

- 数据：[OpenStreetMap](https://www.openstreetmap.org/copyright)，通过 [Overpass API](https://overpass-api.de/api/interpreter)离线提取。
- 署名：© OpenStreetMap contributors。
- 数据许可：[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。本仓库派生道路数据 `public/data/beijing-roads.json` 依据该许可提供。
- OSM 数据基准时间：2026 年 10 月 31 日 03:06:49 UTC；获取时间、查询范围、原始 OSM way 编号和完整查询保存在数据文件中。
- 范围：北京北四环中关村至学院桥一带，包含主路、辅路与进出匝道；两条主路各约 5.6 公里。
- 处理：保留水平道路中心线与连接关系，合并连续道路；道路宽度依据车道标签与统一游戏尺度推定，桥梁高程平面化。建筑体块、植被、护栏、灯杆与路牌为程序化场景，不能作为实景或导航依据。
- 更新入口：`node scripts/fetch-road-data.mjs`。此命令需要联网获取源数据，游戏运行使用仓库内本地数据。

## 当前网页场景外观

当前实际显示的道路场景使用程序化几何、原创路牌贴图和基础材质，尚未加载外部车辆模型、摄影测量城市瓦片或新增字体。已准备的道路贴图、HDR 与中文字体另存 `public/assets/art/`，尚未被代码引用；后续构建会随公开资源目录分发，必须同时保留对应来源与许可。

## 开源技术

- [Three.js](https://github.com/mrdoob/three.js)：MIT。完整声明保存于 `public/licenses/three.txt`，构建时随静态产物分发。
- [Rapier](https://github.com/dimforge/rapier)：Apache-2.0。完整声明保存于 `public/licenses/rapier.txt`，构建时随静态产物分发。
- 车辆悬挂实现参考 [Three.js 官方 Rapier 示例](https://threejs.org/examples/physics_rapier_vehicle_controller.html)与 Rapier 车辆控制器 API；场景计时和渲染使用 Three.js 官方 Timer、WebGLRenderer 和实例化几何能力。依赖与物理 WebAssembly 从本地安装包打包，未保留示例的运行时 CDN 依赖。

## 网页准备中的美术与字体

以下资源于 2026 年 10 月 31 日从原作者或官方发布地址取得，现保存于 `public/assets/art/`。完整作者、源页面、官方文件清单、下载地址、原始文件大小及字体固定提交记录在该目录的 `SOURCES.json`。这些是已取得并转存的源文件，尚未完成 Three.js 贴图、环境光与字体接入，不代表画面已经验证。

| 资源 | 作者与来源 | 许可 | 实际取得内容 |
| --- | --- | --- | --- |
| Asphalt 02 | Rob Tuytel；[Poly Haven 原页面](https://polyhaven.com/a/asphalt_02) | CC0 1.0 | `Textures/Asphalt02/`：2K 漫反射、OpenGL 法线、粗糙度；原始物理尺度约 3 米 × 3 米 |
| Concrete Wall 006 | Charlotte Baglioni 摄影、Dario Barresi 处理；[Poly Haven 原页面](https://polyhaven.com/a/concrete_wall_006) | CC0 1.0 | `Textures/ConcreteWall006/`：2K 漫反射、OpenGL 法线、粗糙度；原始物理尺度约 2 米 × 2 米 |
| Venice Sunset | Greg Zaal；[Poly Haven 原页面](https://polyhaven.com/a/venice_sunset) | CC0 1.0 | `Environment/venice_sunset_2k.hdr`，用于环境光与车漆反射，不表示北京实景 |
| Source Han Sans CN Regular | Adobe Source Han Sans 项目；[官方源仓库](https://github.com/adobe-fonts/source-han-sans) | SIL Open Font License 1.1 | `Fonts/SourceHanSansCN-Regular.otf`，固定提交 `a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2`；原始字体未修改 |

Poly Haven 的模型、HDRI 与材质资源均按其[官方资产许可说明](https://polyhaven.com/license)以 CC0 提供，可用于商业项目；CC0 完整正文保存在 `public/assets/art/Licenses/CC0-1.0.txt`。字体完整许可保存在 `public/assets/art/Fonts/OFL.txt`，随字体一起分发。

本次路线调整只更新记录，没有编辑或转换图像。后续在 Three.js 中分别配置底色、OpenGL 法线和粗糙度贴图，并补齐道路 UV，不能用资源文件存在代替材质已经正确显示。

