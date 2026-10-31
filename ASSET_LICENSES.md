# 资产来源

## 北京道路

- 数据：[OpenStreetMap](https://www.openstreetmap.org/copyright)，通过 [Overpass API](https://overpass-api.de/api/interpreter)离线提取。
- 署名：© OpenStreetMap contributors。
- 数据许可：[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。本仓库派生道路数据 `public/data/beijing-roads.json` 依据该许可提供。
- OSM 数据基准时间：2026 年 10 月 31 日 03:06:49 UTC；获取时间、查询范围、原始 OSM way 编号和完整查询保存在数据文件中。
- 范围：北京北四环中关村至学院桥一带，包含主路、辅路与进出匝道；两条主路各约 5.6 公里。
- 处理：保留水平道路中心线与连接关系，合并连续道路；道路宽度依据车道标签与统一游戏尺度推定，桥梁高程平面化。建筑体块、植被、护栏、灯杆与路牌为程序化场景，不能作为实景或导航依据。
- 更新入口：`node scripts/fetch-road-data.mjs`。此命令需要联网获取源数据，游戏运行使用仓库内本地数据。

## 场景外观

本次道路场景使用程序化几何、原创路牌贴图和基础材质，未打包外部商业模型、摄影测量城市瓦片或网络字体。

## 开源技术

- [Three.js](https://github.com/mrdoob/three.js)：MIT。完整声明保存于 `public/licenses/three.txt`，构建时随静态产物分发。
- [Rapier](https://github.com/dimforge/rapier)：Apache-2.0。完整声明保存于 `public/licenses/rapier.txt`，构建时随静态产物分发。
- 车辆悬挂实现参考 [Three.js 官方 Rapier 示例](https://threejs.org/examples/physics_rapier_vehicle_controller.html)与 Rapier 车辆控制器 API；场景计时和渲染使用 Three.js 官方 Timer、WebGLRenderer 和实例化几何能力。依赖与物理 WebAssembly 从本地安装包打包，未保留示例的运行时 CDN 依赖。
