# SillyTavern 提示词后处理

`st-prompt-post-processing.js` 的 `PROMPT_PROCESSING_TYPE`、`postProcessPrompt`、`mergeMessages` 来自本机 SillyTavern `src/prompt-converters.js`，对应原项目 https://github.com/SillyTavern/SillyTavern 。

许可证：GNU Affero General Public License v3；完整文本保留在 `sillytavern-macros/LICENSE`。本文件仅提取以上函数，将运行时占位符配置固定为原默认值，供用户在 Izumi 附加参数中选择后处理模式。
