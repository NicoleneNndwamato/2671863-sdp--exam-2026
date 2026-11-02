import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "../theme-provider";

/** Shared primitives. Sharp corners, hairline borders, no shadows in dark mode. */

/**
 * A card. Mirrors the mockup's `.card`: one hairline border, a generous inset,
 * and a title set at reading size rather than as an all-caps label - these
 * panels carry names like "Drive temperature", which read better in sentence
 * case.
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  style,
  bodyStyle,
  dense
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  dense?: boolean;
}) {
  const { theme: t } = useTheme();
  return (
    <section
      style={{
        background: t.panel,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: t.line,
        boxShadow: t.shadow,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        ...style
      }}
    >
      {title ? (
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            padding: "13px 15px 0"
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.text }}>{title}</h2>
            {subtitle ? (
              <p style={{ margin: "3px 0 0", fontSize: 11.5, color: t.muted, lineHeight: 1.45 }}>{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>{actions}</div> : null}
        </header>
      ) : null}
      <div
        style={{
          padding: dense ? 0 : "11px 15px 15px",
          paddingTop: title ? (dense ? 0 : 10) : dense ? 0 : 15,
          flex: 1,
          minHeight: 0,
          ...bodyStyle
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  unit,
  hint,
  tone = "neutral"
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "crit" | "info";
}) {
  const { theme: t } = useTheme();
  const colour =
    tone === "ok" ? t.ok : tone === "warn" ? t.warn : tone === "crit" ? t.crit : tone === "info" ? t.info : t.text;

  const alarm = tone === "crit";

  return (
    <div
      className={alarm ? "kpi alarm" : "kpi"}
      style={{
        background: alarm ? `linear-gradient(90deg, ${t.critBg}, transparent 65%), ${t.panel}` : t.panel,
        borderColor: alarm ? t.critBorder : t.line,
        boxShadow: t.shadow
      }}
    >
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={{ color: colour }}>
        {value}
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </span>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </div>
  );
}

type BtnVariant = "default" | "primary" | "ghost" | "danger" | "ok";

export function Btn({
  children,
  onClick,
  variant = "default",
  active,
  disabled,
  title,
  type = "button",
  style,
  full
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  style?: CSSProperties;
  full?: boolean;
}) {
  const { theme: t } = useTheme();

  const base: CSSProperties = {
    // Longhand border properties: mixing `border` with `borderColor` in one
    // object makes React warn and makes the cascade ambiguous.
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.lineSoft,
    background: t.panel2,
    color: t.btnFg,
    padding: "6px 11px",
    fontSize: 11.5,
    fontWeight: 550,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
    width: full ? "100%" : undefined,
    ...style
  };

  const variants: Record<BtnVariant, CSSProperties> = {
    default: {},
    primary: { background: t.primary, borderColor: t.primary, color: t.onPrimary },
    ghost: { background: "transparent", borderColor: "transparent", color: t.muted },
    danger: { background: t.critBg, borderColor: t.critBorder, color: t.crit },
    ok: { background: t.okBg, borderColor: t.ok, color: t.ok }
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className="btn"
      style={{
        ...base,
        ...variants[variant],
        ...(active ? { borderColor: t.primary, color: t.primary, background: t.primaryRgb ? `rgba(${t.primaryRgb}, 0.10)` : t.panel2 } : {})
      }}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "crit" | "info";
}) {
  const { theme: t } = useTheme();
  const map = {
    neutral: { bg: t.panel2, fg: t.muted, bd: t.line },
    ok: { bg: t.okBg, fg: t.ok, bd: t.ok },
    warn: { bg: t.warnBg, fg: t.warn, bd: t.warnBorder },
    crit: { bg: t.critBg, fg: t.crit, bd: t.critBorder },
    info: { bg: t.infoBg, fg: t.info, bd: t.infoBorder }
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: map.bg,
        color: map.fg,
        border: `1px solid ${map.bd}`,
        padding: "1px 6px",
        fontSize: 10,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        fontWeight: 600,
        whiteSpace: "nowrap"
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "ok", pulse }: { tone?: "ok" | "warn" | "crit" | "info" | "muted"; pulse?: boolean }) {
  const { theme: t } = useTheme();
  const colour =
    tone === "ok" ? t.ok : tone === "warn" ? t.warn : tone === "crit" ? t.crit : tone === "info" ? t.info : t.muted3;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: 999,
        background: colour,
        flexShrink: 0,
        animation: pulse ? "pulse 2s ease-in-out infinite" : undefined
      }}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  const { theme: t } = useTheme();
  return (
    <div
      style={{
        padding: "18px 12px",
        textAlign: "center",
        fontSize: 12,
        color: t.muted,
        border: `1px dashed ${t.line}`,
        background: t.panelSunken
      }}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  htmlFor
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  htmlFor?: string;
}) {
  const { theme: t } = useTheme();
  return (
    <label htmlFor={htmlFor} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {/* The hint (a unit, usually) sits on the label line rather than under the
          input, where it would wrap onto its own row in a narrow panel. */}
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: t.muted,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
        >
          {label}
        </span>
        {hint ? <span style={{ fontSize: 10, color: t.muted2, marginLeft: "auto", flexShrink: 0 }}>{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  id,
  type = "text",
  width,
  mono
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  type?: string;
  width?: number | string;
  mono?: boolean;
}) {
  const { theme: t } = useTheme();
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={{
        background: t.panelSunken,
        border: `1px solid ${t.lineSoft}`,
        color: t.text,
        padding: "5px 8px",
        width: width ?? "100%",
        fontFamily: mono ? "var(--font-mono)" : undefined,
        minWidth: 0
      }}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  id
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  id?: string;
}) {
  const { theme: t } = useTheme();
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{
        background: t.panelSunken,
        border: `1px solid ${t.lineSoft}`,
        color: t.text,
        padding: "5px 8px",
        width: "100%",
        minWidth: 0
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export interface ToastMessage {
  id: number;
  tone: "ok" | "warn" | "crit" | "info";
  title: string;
  detail?: string;
}

export function Toasts({ messages, onDismiss }: { messages: ToastMessage[]; onDismiss: (id: number) => void }) {
  const { theme: t } = useTheme();
  if (messages.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ position: "fixed", left: 16, bottom: 100, display: "flex", flexDirection: "column", gap: 8, zIndex: 60, maxWidth: 340 }}
    >
      {messages.map((message) => (
        <div
          key={message.id}
          style={{
            background: t.panel,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor:
              message.tone === "crit" ? t.critBorder : message.tone === "warn" ? t.warnBorder : t.line,
            borderLeftWidth: 3,
            borderLeftStyle: "solid",
            borderLeftColor:
              message.tone === "crit" ? t.crit : message.tone === "warn" ? t.warn : message.tone === "ok" ? t.ok : t.info,
            padding: "8px 10px",
            boxShadow: t.shadow,
            display: "flex",
            gap: 10,
            alignItems: "flex-start"
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{message.title}</div>
            {message.detail ? <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>{message.detail}</div> : null}
          </div>
          <button
            onClick={() => onDismiss(message.id)}
            aria-label="Dismiss notification"
            style={{ background: "transparent", border: "none", color: t.muted, cursor: "pointer", padding: 0, fontSize: 14 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** A definition row used in detail panels. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  const { theme: t } = useTheme();
  return (
    <div
      style={{
        // Grid, not flex: the label may wrap to a second line in a narrow card
        // while the value stays on one line. Flex would let the value be pushed
        // out of the card instead.
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "baseline",
        gap: 8,
        padding: "4px 0",
        borderBottom: `1px solid ${t.lineSoft}`,
        fontSize: 12
      }}
    >
      <span style={{ color: t.muted, overflowWrap: "anywhere" }}>{label}</span>
      <span
        style={{
          color: t.text,
          fontFamily: "var(--font-mono)",
          textAlign: "right",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {value}
      </span>
    </div>
  );
}
