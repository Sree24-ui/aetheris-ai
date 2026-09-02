function initialsFrom(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.trim() || "";
  if (!source) return "?";
  const parts = source.includes("@") ? [source.split("@")[0]] : source.split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
  return initials.toUpperCase() || "?";
}

interface Props {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  size?: number;
  className?: string;
}

export default function UserAvatar({ name, email, image, size = 28, className = "" }: Props) {
  const dimension = `${size}px`;
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={name || email || "User"}
        width={size}
        height={size}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: dimension, height: dimension }}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-primary-container/40 flex items-center justify-center shrink-0 text-primary-fixed-dim font-semibold ${className}`}
      style={{ width: dimension, height: dimension, fontSize: `${Math.max(10, size * 0.4)}px` }}
    >
      {initialsFrom(name, email)}
    </div>
  );
}
