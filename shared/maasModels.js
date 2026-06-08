export const DEFAULT_MAAS_MODEL = 'deepseek-v4-flash';

export const HUAWEI_MAAS_TEXT_MODELS = [
  { value: 'deepseek-v3.2', label: 'DeepSeek-V3.2', note: '性价比好，适合普通文本生成与批量任务' },
  { value: 'deepseek-v3.1-terminus', label: 'DeepSeek-V3.1', note: 'DeepSeek-V3.x 备选' },
  { value: 'DeepSeek-V3', label: 'DeepSeek-V3', note: '官方 MaaS V2 大写 model 参数' },
  { value: 'deepseek-r1-250528', label: 'DeepSeek-R1-0528', note: '推理模型，输出和成本更不稳定' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash', note: '价格低，但 RPM 低' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', note: '少量高质量请求' },
  { value: 'qwen3-30b-a3b', label: 'Qwen3-30B-A3B', note: '低价 Qwen3，自动关闭 thinking' },
  { value: 'qwen3-235b-a22b', label: 'Qwen3-235B-A22B', note: '强模型候选，自动关闭 thinking' },
  { value: 'qwen3-32b', label: 'Qwen3-32B', note: 'Qwen3 小模型对照，自动关闭 thinking' },
  { value: 'longcat-flash-chat', label: 'LongCat-Flash-Chat', note: 'TPM 高，适合高吞吐文本任务' },
  { value: 'glm-5.1', label: 'GLM-5.1', note: 'RPM 较低' },
  { value: 'glm-5', label: 'GLM-5', note: 'RPM 较低' },
  { value: 'kimi-k2.6', label: 'Kimi-K2.6', note: 'RPM 较低' },
];

export function isValidMaasModel(model) {
  return HUAWEI_MAAS_TEXT_MODELS.some(item => item.value === model);
}

export function isQwen3Model(model) {
  return model?.startsWith('qwen3-');
}
