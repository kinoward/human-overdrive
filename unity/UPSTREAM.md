# Unity 车辆框架来源

本目录采用 [Randomation Vehicle Physics](https://github.com/JustInvoke/Randomation-Vehicle-Physics)，由 JustInvoke 发布。

## 固定版本

- 仓库：`https://github.com/JustInvoke/Randomation-Vehicle-Physics`
- 提交：`192ba860c3c92a16363ffe87fb943dc282e62398`
- 上游项目版本：Unity `2019.4.0f1`，修订 `0af376155913`。
- 本项目目标版本：Unity `6000.3.12f1`，修订 `fca03ac9b0d5`。
- 本次保留 `Assets/`、`Packages/`、`ProjectSettings/` 及全部 `.meta` 引用；原始 README 保存为 `README.upstream.md`，MIT 声明保存为 `MIT LICENSE.txt`。
- 未复制上游 Git 历史、日志与个人开发工具配置。

## 许可

上游 README 明确代码采用 MIT，模型与纹理为原作者制作并按 Public Domain 提供。保留原始版权、许可证和注释，不将上游代码描述为本项目原创。

字体 Roboto 采用 Apache 许可。音频包含 Public Domain、CC Attribution 与 Creative Commons Sampling Plus 等不同许可，具体来源链接保留在 `README.upstream.md`；不能将全部声音统一称为 MIT 或无条件使用。正式分发前需按实际使用的声音分别处理署名与使用条件。

## 当前导入边界

车辆物理、摩托平衡、损坏变形、掉件、破裂、跟随 AI 与样例素材直接复用上游。当前保留 Built-in 渲染素材，不执行 URP 转换，也不把样例车辆当作指定宝马或特斯拉的精细模型。

目前仅将 `ProjectSettings/ProjectVersion.txt` 的目标编辑器改为本项目版本。其余上游脚本、包清单和物理、图层、输入设置保持原样，尚未依据实际编译错误进行兼容修订。Unity 6 的旧 API、包依赖、导入与运行兼容性仍须由实际编辑器确认；文件已导入不代表已编译或试玩通过。

## 入口与依赖

- 完整样例：`Assets/Scenes/Demo.unity`。
- 地形样例：`Assets/Scenes/Terrain Example.unity`。
- 损坏汽车：`Assets/Prefabs/Vehicles/Car Damage.prefab`。
- 摩托车：`Assets/Prefabs/Vehicles/Motorcycle.prefab`。
- 追逐汽车：`Assets/Prefabs/Vehicles/Chase Car.prefab`。
- 场景控制：`Assets/Prefabs/GlobalControl.prefab` 与 `Assets/Prefabs/TimeMaster.prefab`。

先打开 `unity/` 工程与完整样例，再接入项目玩法。预制体依赖场景控制、时间管理、输入轴、物理材质和 `Ignore Wheel Cast` 等图层，不应只复制单个汽车对象。

玩家车辆接入翻车失败规则时，应关闭 `VehicleAssist` 的自动扶正与转向扶正，禁用样例调试复位和快速重开输入，避免样例行为覆盖游戏结算。警追和累计里程等项目规则由独立游戏模块接入，不改写到通用上游框架中。
