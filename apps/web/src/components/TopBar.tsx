import type { ReactNode } from "react";
import { useAppStore } from "../stores/AppStore.tsx";

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const { connection } = useAppStore();

  return (
    <header className="topbar">
      {onBack ? (
        <button type="button" className="icon-button" onClick={onBack} aria-label="返回">
          ‹
        </button>
      ) : (
        <span className={`conn conn-${connection}`} title={`WebSocket: ${connection}`} />
      )}
      <div className="topbar-title">
        <div className="topbar-title-main">{title}</div>
        {subtitle ? <div className="topbar-title-sub">{subtitle}</div> : null}
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

export function ControlToggle() {
  const { session, setControlMode } = useAppStore();
  const on = session?.controlMode === true;
  return (
    <button
      type="button"
      className={`control-toggle ${on ? "on" : "off"}`}
      onClick={() => void setControlMode(!on)}
      title={on ? "点击回到只读" : "点击开启控制模式"}
    >
      {on ? "CONTROL" : "READ ONLY"}
    </button>
  );
}
