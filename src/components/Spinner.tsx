export default function Spinner({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <span
      className="inline-block shrink-0 animate-spin rounded-full"
      style={{ width: size, height: size, border: `2px solid ${color}33`, borderTopColor: color }}
    />
  );
}
