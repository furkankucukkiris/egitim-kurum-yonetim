interface AvatarProps {
  name: string;
  size?: number;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 28 }: AvatarProps) {
  return (
    <div
      className="flex items-center justify-center rounded-full bg-primary-soft text-primary font-medium shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {getInitials(name)}
    </div>
  );
}
