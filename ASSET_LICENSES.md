# 资产来源

## 北京道路

- 数据：[OpenStreetMap](https://www.openstreetmap.org/copyright)，通过 [Overpass API](https://overpass-api.de/api/interpreter)离线提取。
- 署名：© OpenStreetMap contributors。
- 数据许可：[Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。本仓库派生道路数据 `public/data/beijing-roads.json` 依据该许可提供。
- OSM 数据基准时间：2026 年 10 月 31 日 05:29:19 UTC；获取时间、查询范围、原始 OSM way 编号和完整查询保存在数据文件中。
- 范围：北京完整四环，包含双向主路、辅路与连接匝道；两条主路闭环分别约 65.294 和 65.173 公里。
- 处理：经纬度按球面局部等距投影转换为米，保留真实水平道路中心线与共同节点连接，合并兼容的连续道路。道路宽度依据 OSM 宽度或车道标签推定；桥隧层级按每层 6.5 米和连续缓坡简化，非实测高程。原始采用数据另存 `public/data/beijing-roads.source.json`，同样按 ODbL 分发；`beijing-map.svg` 由这些真实道路中心线绘制。道路设施为本项目程序化三维场景，建筑与行道树使用下述开发期生成模型，不是测绘实景或导航依据。
- 更新入口：`node scripts/fetch-road-data.mjs`。此命令需要联网获取源数据，游戏运行使用仓库内本地数据。

## 背景音乐

用户指定的[《给我闹》《细妹细狗》《匹配の小曲》拼接完整版](https://www.bilibili.com/video/BV1HWup6tEJz/)由 B 站 UP 主 MMD老狼上传，原音轨约 499.787 秒；视频描述说明其由两首曲子拼接，用于「争取最后的自由」追车视频风格的配乐参考。上传者不等于原曲作者，精确混音版本尚未确认。

运行文件位于 `public/assets/music/`，五份 AAC-LC 立体声 M4A 共 12514036 字节：菜单保留完整音轨，普通驾驶取原音轨 90.35–120.35 秒，追逐取 127.55–180.05 秒，成功取 240.10–251.35 秒，失败取 180.10–187.60 秒。循环段首尾作 12 毫秒淡变以减轻切点爆音，结算段末尾渐弱；没有更改原曲速度。完整来源、SHA-256、实际时长、剪辑与转码信息见同目录 `SOURCES.json`。

未找到允许游戏再分发的公开许可，不将该配乐标为原创、CC0 或已获商业授权。视频注明未经作者授权禁止转载，简介要求不要在其他音乐平台二次发布或收费；记录用户指定的素材来源不替代权利人授权。

## 当前网页场景外观

当前道路场景使用真实比例程序化路面、实体设施、原创路牌与立体建筑植被模块，并已加载 `public/assets/art/` 中的道路贴图、HDR 与中文字体。已接入主办方 Tripo 生成的车辆、住宅与行道树 GLB，未接入摄影测量城市瓦片；构建随公开资源目录分发对应来源与许可。

## 开源技术

- [Three.js](https://github.com/mrdoob/three.js)：MIT。完整声明保存于 `public/licenses/three.txt`，构建时随静态产物分发。
- [Rapier](https://github.com/dimforge/rapier)：Apache-2.0。完整声明保存于 `public/licenses/rapier.txt`，构建时随静态产物分发。
- 轻量车损参考 [Randomation Vehicle Physics](https://github.com/JustInvoke/Randomation-Vehicle-Physics/tree/192ba860c3c92a16363ffe87fb943dc282e62398) 的 `VehicleDamage.cs`、`DetachablePart.cs` 与 `ShatterPart.cs`，采用局部距离衰减、破损状态和脱落速度继承思路，以 TypeScript 独立实现；没有复制上游模型、纹理或音效。参考代码为 Justin Couch 的 MIT 许可，完整声明随 `public/licenses/randomation-vehicle-physics.txt` 分发。本项目碎片音效仍由浏览器合成。
- 车辆悬挂实现参考 [Three.js 官方 Rapier 示例](https://threejs.org/examples/physics_rapier_vehicle_controller.html)与 Rapier 车辆控制器 API；场景计时和渲染使用 Three.js 官方 Timer、WebGLRenderer 和实例化几何能力。依赖与物理 WebAssembly 从本地安装包打包，未保留示例的运行时 CDN 依赖。

## 已接入的网页美术与字体

以下资源于 2026 年 10 月 31 日从原作者或官方发布地址取得，现保存于 `public/assets/art/`。完整作者、源页面、官方文件清单、下载地址、原始文件大小及字体固定提交记录在该目录的 `SOURCES.json`。这些源文件现由 Three.js 场景加载；本轮实际浏览器验证范围见执行计划。

| 资源 | 作者与来源 | 许可 | 实际取得内容 |
| --- | --- | --- | --- |
| Asphalt 02 | Rob Tuytel；[Poly Haven 原页面](https://polyhaven.com/a/asphalt_02) | CC0 1.0 | `Textures/Asphalt02/`：2K 漫反射、OpenGL 法线、粗糙度；原始物理尺度约 3 米 × 3 米 |
| Concrete Wall 006 | Charlotte Baglioni 摄影、Dario Barresi 处理；[Poly Haven 原页面](https://polyhaven.com/a/concrete_wall_006) | CC0 1.0 | `Textures/ConcreteWall006/`：2K 漫反射、OpenGL 法线、粗糙度；原始物理尺度约 2 米 × 2 米 |
| Venice Sunset | Greg Zaal；[Poly Haven 原页面](https://polyhaven.com/a/venice_sunset) | CC0 1.0 | `Environment/venice_sunset_2k.hdr`，用于环境光与车漆反射，不表示北京实景 |
| Source Han Sans CN Regular | Adobe Source Han Sans 项目；[官方源仓库](https://github.com/adobe-fonts/source-han-sans) | SIL Open Font License 1.1 | `Fonts/SourceHanSansCN-Regular.otf`，固定提交 `a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2`；原始字体未修改 |

Poly Haven 的模型、HDRI 与材质资源均按其[官方资产许可说明](https://polyhaven.com/license)以 CC0 提供，可用于商业项目；CC0 完整正文保存在 `public/assets/art/Licenses/CC0-1.0.txt`。字体完整许可保存在 `public/assets/art/Fonts/OFL.txt`，随字体一起分发。

Three.js 已分别配置 sRGB 底色、非颜色法线与粗糙度、米制道路 UV、HDR 反射与路牌中文字体。未编辑或转换原始材质图片。

## 开发期生成的场景参考

2026 年 10 月 31 日通过主办方提供的 [V2FUN](https://v2fun.ai/) 网页工作区生成两张 16:9 图像，页面所选模型为 gpt-image-2：`docs/调研/参考图/北京四环-简化写实参考.png` 与 `北京四环-风格化参考.png`。图像只用于美术方向比较，未作为游戏模型、贴图或地图数据加载；用户更偏好前者。制作目标与用途见[赞助资源与资产制作](docs/调研/赞助资源与资产制作.md)。


## 开发期生成并复用的三维模型

2026 年 10 月 31 日通过主办方提供的 [Tripo Studio](https://studio.tripo3d.ai/) 网页生成 H3.1 模型，保留原始平台资产，运行版本放入 `public/assets/generated/`。平台项目链接、文件大小、三角面数量与处理方式见该目录 `SOURCES.json`，使用遵守 [Tripo 条款](https://www.tripo3d.ai/terms)，不将这些输出标为 CC0 或指定现实车型的精确复原。

| 文件 | 用途 | 整理方式 |
| --- | --- | --- |
| `electric-suv.glb` | 玩家 SUV、普通交通与警车共享 | 车身和四个轮轴；30 份材质合并为一套底色与材质参数贴图 |
| `adventure-motorcycle.glb` | 玩家摩托与骑手 | 合并静态车身与骑手，保留前后轮轴，共享一套材质 |
| `residential-block.glb` | 沿线重复住宅 | 米制归一与减面，按邻近道路朝向复用 |
| `roadside-tree.glb` | 重复行道树 | 米制归一，近景与低细节远景共享材质 |

四套运行文件共约 3.5 MB，几何使用 Meshopt 压缩，贴图转 WebP；游戏只加载本地文件，共享网格、材质和贴图。车辆轮径、轴心和朝向经整理，保留街机性能参数，不作为厂商规格。整理脚本为 `scripts/prepare-generated-models.mjs`。

Meshoptimizer 的 MIT 许可保存在 `public/licenses/meshoptimizer.txt`，随运行时解码器与静态产物分发。地表细节使用原创程序噪声，混凝土去色在材质渲染中完成，未覆盖原始开放贴图。

## 生成的竞速界面素材

`public/assets/ui-racing/` 使用内置图片生成能力制作，主菜单背景和摩托选车图为原创生成的写实竞速画面，车辆无品牌，城市建筑不作为实景复原。图片使用 WebP 编码压缩，提示词、原始生成文件及转换方式记录在 `hero-generation.json`。

五座城市的关卡地图由真实地图参考进行风格化生成，记录在 `maps/map-generation.json`；精确地理范围、来源链接和署名保存在 `references/metadata.json`。北京参考仓库已有 OpenStreetMap 四环道路数据与 SVG，继续标明 © OpenStreetMap 贡献者和 ODbL 1.0。上海、重庆、东京和洛杉矶以 Esri World Street Map 的单张静态地图作为事实地理参考，数据与渲染版权仍归 Esri 及其数据提供者，不宣称 CC0 或其他开放许可。

仅生成的地图美术、提示词和参考元数据随静态产物发布；有版权的原始地图参考图片在本机归档，不作为上线图片分发。生成时保留主要道路、水系与海岸的方位关系，重新绘制材质、灯光和色彩，不复用源图标注、标志或图例。生成图是艺术化关卡封面，不作为测绘成果、精确导航地图或实际可玩城市的承诺。

## 街景补充模型与自然衔接

2026 年 10 月 31 日继续使用主办方 Tripo Studio H3.1，并行生成低层砖色住宅、现代办公楼与细长行道树，再分别生成 2K 底色纹理。成品为 `public/assets/generated/brick-apartment.glb`、`office-block.glb` 和 `slender-tree.glb`；三个文件共约 0.92 MB，来源链接、最终米制包围盒、面数及处理方式记录于同目录 `STREETSCAPE_SOURCES.json`。使用沿用 Tripo 条款，不宣称 CC0、实景复原或完整 PBR 贴图包。

脚本 `scripts/prepare-streetscape-models.mjs` 仅处理本批三项，保持等比缩放，修正正立面朝向，删除办公楼远离主体的 691 面离散碎片；树木近景 6459 面、远景 924 面，共享材质和底色图。运行时按亮度与色相将过亮叶片校正为低饱和绿色，保留较暗树干，不改动其他共享模型。新街区、步道、庭院、绿篱、地被与渐淡土草色斑由本项目原创几何和材质生成；不使用欧卡2的受保护模型或贴图。

## NPC 混合车队生成资产

2026 年 10 月 31 日通过主办方提供的 Tripo Studio H3.1，继续真实生成配送厢式货车、大型刚性厢式货车和公交，并分别生成 2K 底色纹理。三个运行文件位于 `public/assets/generated/traffic/`，合计 858992 字节；源任务链接、提示词、实测包围盒及处理边界见该目录 `SOURCES.json` 和各车型 JSON。沿用 [Tripo 条款](https://www.tripo3d.ai/terms)，不标为 CC0、现实品牌型号或道路法规仿真。

| 运行文件 | 实际用途 | 长 × 宽 × 高 |
| --- | --- | --- |
| `delivery-van.glb` | 配送厢式货车 NPC | 5.5 × 2.05 × 2.5 米 |
| `box-truck.glb` | 大型刚性厢式货车 NPC | 9.2 × 2.5 × 3.5 米 |
| `city-bus.glb` | 公交 NPC | 10.5 × 2.5 × 3.2 米 |

整理命令为 `node scripts/prepare-traffic-models.mjs <原始车辆目录> <独立工具目录> [车型名]`，复用架构地图列出的模型工具依赖；脚本为 `scripts/prepare-traffic-models.mjs`，统一 Y 向上、+Z 车头、地面为 0 和长向居中，采用 Meshopt 与 WebP。三款当前均为单车体网格、单材质和单纹理，车轮仍包含于车体，未宣称独立轮轴；已有 SUV 和摩托继续复用原生成模型及其轮轴。运行时共享几何与纹理，每辆车克隆自己的渐显材质，不因单车回收或销毁释放其他车辆资源。

## 城市选择地球影像

`public/assets/ui-racing/globe/earth-blue-marble.jpg` 为 NASA Goddard Space Flight Center 的 Blue Marble 2002 全球合成影像，原文件 `land_ocean_ice_2048.jpg`，2048×1024，266599 字节。直接从 [NASA 官方影像地址](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg)保存，未修改像素；来源、下载地址和使用说明见同目录 `SOURCES.json`。

使用遵循 [NASA 图片与媒体规范](https://www.nasa.gov/nasa-brand-center/images-and-media/)，界面署名 NASA Goddard Space Flight Center / Blue Marble，不使用 NASA 标识或暗示其对游戏背书。地球影像为历史全球合成，不代表实时卫星画面；城市标记采用真实城市中心经纬度，不等同于比赛起跑点。运行时从本地离线加载，与其余关卡封面生成素材分别记录来源。

## 路侧自然绿化与候车设施

2026 年 10 月 31 日继续通过主办方 Tripo Studio H3.1，并行生成 `lush-shrub.glb` 自然灌木和 `bus-shelter.glb` 通用候车亭。两项在生成时启用2K纹理与PBR，实际导出均包含底色、粗糙金属与法线贴图；处理后灌木贴图为1K、候车亭为2K，运行文件共约1.09 MB。平台任务、实际尺寸、贴图用途和面数保存在 `public/assets/generated/ROADSIDES_SOURCES.json`，沿用 Tripo 条款，不宣称 CC0 或真实公交站复原。

整理脚本 `scripts/prepare-roadside-models.mjs` 保持等比、居中落地与开敞面朝向，灌木提供2908面近景及440面远景，减面时保护外轮廓并保留对应UV与法线。住宅侧墙窗框、窗台、空调、落水管与勒脚为原创几何，按实际模型墙面射线定位；站牌仅标“公交候车”，不包含虚构线路或真实站名。草地色差、平台、垃圾桶和界桩同样由本项目构造。
