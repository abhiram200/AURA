const MIN_TOKENS = 131072 // 128K
const MAX_TOKENS = 1_048_576 // 1M

function sliderToTokens(position: number): number {
  const t = position / 100
  return Math.round(MIN_TOKENS * Math.pow(MAX_TOKENS / MIN_TOKENS, t))
}

function tokensToSlider(tokens: number): number {
  const t = Math.log(tokens / MIN_TOKENS) / Math.log(MAX_TOKENS / MIN_TOKENS)
  return Math.round(t * 100)
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_048_576) {
    const m = tokens / 1_048_576
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (tokens >= 1024) {
    const k = tokens / 1024
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`
  }
  return String(tokens)
}

interface ContextSettingsProps {
  contextWindowSize: number;
  onContextWindowSizeChange: (size: number) => void;
  autoExtractMemory: boolean;
  onAutoExtractMemoryChange: (enabled: boolean) => void;
}

export function ContextSettings({
  contextWindowSize,
  onContextWindowSizeChange,
  autoExtractMemory,
  onAutoExtractMemoryChange,
}: ContextSettingsProps) {
  const sliderValue = tokensToSlider(contextWindowSize)

  return (
    <div className="context-settings">
      <div className="context-settings__row">
        <label className="context-settings__label">
          Context Window
        </label>
        <span className="context-settings__value">{formatTokenCount(contextWindowSize)}</span>
      </div>
      <div className="context-settings__slider-row">
        <span className="context-settings__tick">128K</span>
        <input
          type="range"
          min="0"
          max="100"
          value={sliderValue}
          onChange={(e) => onContextWindowSizeChange(sliderToTokens(parseInt(e.target.value, 10)))}
          className="context-settings__range"
        />
        <span className="context-settings__tick">1M</span>
      </div>
      <div className="context-settings__row">
        <label className="context-settings__label">Auto-Extract Memory</label>
        <button
          className={`context-settings__toggle ${autoExtractMemory ? 'context-settings__toggle--on' : 'context-settings__toggle--off'}`}
          onClick={() => onAutoExtractMemoryChange(!autoExtractMemory)}
        >
          {autoExtractMemory ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  );
}