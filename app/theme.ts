// Reusable inline style tokens, mirroring the design's {{ style }} bindings.
import type { CSSProperties } from "react";

export const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 26,
  marginBottom: 20,
  boxShadow: "0 4px 20px rgba(11,46,107,.06)",
};

export const cardHead: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 18,
};

export const iconChip: CSSProperties = {
  width: 50,
  height: 50,
  borderRadius: 14,
  background: "var(--chip)",
  color: "var(--blue,#0b2e6b)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  border: "1px solid var(--border)",
};

export const eyebrow: CSSProperties = {
  fontSize: ".76em",
  fontWeight: 800,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--red,#c62026)",
  marginBottom: 4,
};

export const h2: CSSProperties = {
  fontFamily: "var(--display)",
  fontSize: "1.5em",
  fontWeight: 700,
  margin: "0 0 6px",
  color: "var(--text)",
  lineHeight: 1.1,
};

export const lead: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: "1em",
  lineHeight: 1.55,
  maxWidth: 640,
};

export const label: CSSProperties = {
  display: "block",
  fontSize: ".82em",
  fontWeight: 800,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 8,
};

export const textarea: CSSProperties = {
  width: "100%",
  background: "var(--chip)",
  border: "1.5px solid var(--border)",
  borderRadius: 14,
  padding: "14px 16px",
  color: "var(--text)",
  fontSize: "1em",
  resize: "vertical",
  fontFamily: "inherit",
};

export const input: CSSProperties = {
  background: "var(--chip)",
  border: "1.5px solid var(--border)",
  borderRadius: 12,
  padding: "9px 14px",
  color: "var(--text)",
  fontSize: "1em",
  fontWeight: 700,
  fontFamily: "inherit",
};

export const btnPrimary: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  background: "var(--blue,#0b2e6b)",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "12px 20px",
  fontWeight: 700,
  fontSize: "1em",
  boxShadow: "0 4px 14px rgba(11,46,107,.28)",
};

export const btnGhost: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  background: "var(--card,#fff)",
  color: "var(--blue,#0b2e6b)",
  border: "1.5px solid var(--border,#d7deef)",
  borderRadius: 12,
  padding: "11px 18px",
  fontWeight: 700,
};

export const toolBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 38,
  height: 38,
  padding: "0 10px",
  borderRadius: 10,
  border: "1.5px solid var(--border)",
  background: "var(--card)",
  color: "var(--blue,#0b2e6b)",
  fontWeight: 800,
};

export const footBadge: CSSProperties = {
  fontSize: ".78em",
  fontWeight: 700,
  color: "var(--muted)",
  background: "var(--chip)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "6px 12px",
};

export const keyRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: ".9em",
  color: "var(--text)",
};

export const kbd: CSSProperties = {
  fontFamily: "var(--display)",
  fontSize: ".82em",
  fontWeight: 700,
  background: "var(--chip)",
  border: "1px solid var(--border)",
  borderBottomWidth: 2,
  borderRadius: 7,
  padding: "2px 8px",
  color: "var(--blue,#0b2e6b)",
};

export const hero: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: "linear-gradient(135deg,#0b2e6b 0%,#123d86 55%,#0a2350 100%)",
  borderRadius: 24,
  padding: 32,
  marginBottom: 22,
  color: "#fff",
};

export const themePill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontSize: ".8em",
  fontWeight: 700,
  color: "#cfe0ff",
  background: "rgba(255,255,255,.12)",
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 999,
  padding: "6px 13px",
};

export const heroBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  fontSize: ".85em",
  fontWeight: 700,
  color: "#fff",
  background: "rgba(255,255,255,.1)",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 12,
  padding: "10px 14px",
};

export const heroLogo: CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 15,
  background: "rgba(255,255,255,.12)",
  border: "1px solid rgba(255,255,255,.2)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
};

export const gradeChip = (kind: "before" | "after"): CSSProperties => ({
  padding: "3px 11px",
  borderRadius: 999,
  fontWeight: 800,
  color: kind === "after" ? "#fff" : "var(--muted)",
  background: kind === "after" ? "var(--blue,#0b2e6b)" : "var(--chip)",
  border: "1px solid var(--border)",
});
