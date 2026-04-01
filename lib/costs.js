const MODEL_PRICING = {
  "gpt-4o": {
    inputPer1M: 2.5,
    cachedInputPer1M: 1.25,
    outputPer1M: 10.0,
  },
  "gpt-4o-mini": {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    outputPer1M: 0.6,
  },
  "gpt-5.4": {
    inputPer1M: 2.5,
    cachedInputPer1M: 0.25,
    outputPer1M: 15.0,
  },
  "gpt-5.4-mini": {
    inputPer1M: 0.75,
    cachedInputPer1M: 0.075,
    outputPer1M: 3.0,
  },
};

function dollarsFromTokens({
  model,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
}) {
  const pricing = MODEL_PRICING[model];

  if (!pricing) {
    return 0;
  }

  const inputCost = (inputTokens / 1000000) * pricing.inputPer1M;
  const cachedInputCost =
    (cachedInputTokens / 1000000) * pricing.cachedInputPer1M;
  const outputCost = (outputTokens / 1000000) * pricing.outputPer1M;

  return Number((inputCost + cachedInputCost + outputCost).toFixed(6));
}

function summarizeUsage(usage = {}) {
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const cachedInputTokens = Number(
    usage.input_tokens_details?.cached_tokens || 0
  );

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}

module.exports = {
  MODEL_PRICING,
  dollarsFromTokens,
  summarizeUsage,
};
