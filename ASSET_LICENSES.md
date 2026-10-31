# 资产来源

## 北京道路

- 数据：[OpenStreetMap](https://www.openstreetmap.org/copyright)，通过 [Overpass API](https://overpass-api.de/api/interpreter)离线提取。
- 署名：© OpenStreetMap contributors。
- 数据许可：[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。本仓库派生道路数据 `public/data/beijing-roads.json` 依据该许可提供。
- OSM 数据基准时间：2026 年 10 月 31 日 03:06:49 UTC；获取时间、查询范围、原始 OSM way 编号和完整查询保存在数据文件中。
- 范围：北京北四环中关村至学院桥一带，包含主路、辅路与进出匝道；两条主路各约 5.6 公里。
- 处理：保留水平道路中心线与连接关系，合并连续道路；道路宽度依据车道标签与统一游戏尺度推定，桥梁高程平面化。建筑体块、植被、护栏、灯杆与路牌为程序化场景，不能作为实景或导航依据。
- 更新入口：`node scripts/fetch-road-data.mjs`。此命令需要联网获取源数据，游戏运行使用仓库内本地数据。

## 网页原型场景外观

本次道路场景使用程序化几何、原创路牌贴图和基础材质，未打包外部商业模型、摄影测量城市瓦片或网络字体。

## 开源技术

- [Three.js](https://github.com/mrdoob/three.js)：MIT。完整声明保存于 `public/licenses/three.txt`，构建时随静态产物分发。
- [Rapier](https://github.com/dimforge/rapier)：Apache-2.0。完整声明保存于 `public/licenses/rapier.txt`，构建时随静态产物分发。
- 车辆悬挂实现参考 [Three.js 官方 Rapier 示例](https://threejs.org/examples/physics_rapier_vehicle_controller.html)与 Rapier 车辆控制器 API；场景计时和渲染使用 Three.js 官方 Timer、WebGLRenderer 和实例化几何能力。依赖与物理 WebAssembly 从本地安装包打包，未保留示例的运行时 CDN 依赖。

## Unity 车辆框架与样例

- 来源：[JustInvoke / Randomation Vehicle Physics](https://github.com/JustInvoke/Randomation-Vehicle-Physics)，固定提交 `192ba860c3c92a16363ffe87fb943dc282e62398`。
- 代码：MIT，完整声明在 `unity/MIT LICENSE.txt`，上游说明在 `unity/README.upstream.md`。
- 模型和纹理：原作者明确按 Public Domain 提供，包括完整车辆、损坏部件与城市示例资源。
- Roboto 字体：上游说明采用 Apache 许可；音频包含 Public Domain、CC BY 和 Sampling Plus 等不同许可，原始作者与来源链接保留在上游 README。不能把全部上游文件统一称为 MIT 或无条件使用。
- 具体导入和修改边界见 [Unity 来源记录](unity/UPSTREAM.md)。当前复用源码与资产不等于已完成 Unity 6 导入、编译和画面验证。

## Unity 迁移版本的美术与字体

以下资源于 2026 年 10 月 31 日从原作者或官方发布地址取得，保存于 `unity/Assets/HumanOverdrive/Art/`。完整作者、源页面、官方文件清单、下载地址、原始文件大小及字体固定提交记录在该目录的 `SOURCES.json`。这些是已取得的源文件，不表示已经完成 Unity 导入、材质配置或场景效果验证；上文 Three.js 原型记录仍对应旧版实现。

| 资源 | 作者与来源 | 许可 | 实际取得内容 |
| --- | --- | --- | --- |
| Asphalt 02 | Rob Tuytel；[Poly Haven 原页面](https://polyhaven.com/a/asphalt_02) | CC0 1.0 | `Textures/Asphalt02/`：2K 漫反射、OpenGL 法线、粗糙度；原始物理尺度约 3 米 × 3 米 |
| Concrete Wall 006 | Charlotte Baglioni 摄影、Dario Barresi 处理；[Poly Haven 原页面](https://polyhaven.com/a/concrete_wall_006) | CC0 1.0 | `Textures/ConcreteWall006/`：2K 漫反射、OpenGL 法线、粗糙度；原始物理尺度约 2 米 × 2 米 |
| Venice Sunset | Greg Zaal；[Poly Haven 原页面](https://polyhaven.com/a/venice_sunset) | CC0 1.0 | `Environment/venice_sunset_2k.hdr`，用于环境光与车漆反射，不表示北京实景 |
| Source Han Sans CN Regular | Adobe Source Han Sans 项目；[官方源仓库](https://github.com/adobe-fonts/source-han-sans) | SIL Open Font License 1.1 | `Fonts/SourceHanSansCN-Regular.otf`，固定提交 `a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2`；原始字体未修改 |

Poly Haven 的模型、HDRI 与材质资源均按其[官方资产许可说明](https://polyhaven.com/license)以 CC0 提供，可用于商业项目；CC0 完整正文保存在 `Art/Licenses/CC0-1.0.txt`。字体完整许可保存在 `Art/Fonts/OFL.txt`，随字体一起分发。

本轮没有编辑或转换这些图像，也没有手写 Unity 材质、预制体或场景文件。法线贴图应由 Unity 导入器配置为法线类型；粗糙度源图不能直接视为 Unity Standard 的平滑度，后续材质接入需按实际渲染管线处理。
