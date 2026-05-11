interface SettingsCardProps {
  icon: string;
  title: string;
  subtitle: string;
  subtitleColor?: string;
  onClick: () => void;
  span?: number;
}

export function SettingsCard({ icon, title, subtitle, subtitleColor, onClick, span }: SettingsCardProps) {
  return (
    <button
      className="settings-card"
      onClick={onClick}
      style={span ? { gridColumn: `span ${span}` } : undefined}
    >
      <div className="settings-card__icon">{icon}</div>
      <div className="settings-card__title">{title}</div>
      <div className="settings-card__subtitle" style={subtitleColor ? { color: subtitleColor } : undefined}>
        {subtitle}
      </div>
    </button>
  );
}