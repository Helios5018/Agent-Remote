import type { ReactNode } from "react";
import { APP_NAME_MAX_LENGTH, DEFAULT_HOME_TITLE } from "../appName.ts";
import { useAppStore } from "../stores/AppStore.tsx";
import { EditableName } from "./EditableName.tsx";

export function TopBar({
  title,
  subtitle,
  onBack,
  onRename,
  renameMaxLength = APP_NAME_MAX_LENGTH,
  renamePlaceholder = DEFAULT_HOME_TITLE,
  renameAriaLabel = "应用名称",
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** 有这个回调时，点标题就能改名。 */
  onRename?: (name: string) => void;
  renameMaxLength?: number;
  renamePlaceholder?: string;
  renameAriaLabel?: string;
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
        <EditableName
          value={title}
          onRename={onRename}
          className={onRename ? "topbar-title-main topbar-title-edit" : "topbar-title-main"}
          inputClassName="topbar-title-input"
          maxLength={renameMaxLength}
          placeholder={renamePlaceholder}
          ariaLabel={renameAriaLabel}
        />
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
