export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div
      aria-hidden
      className="grid flex-none place-items-center bg-primary font-extrabold text-primary-foreground"
      style={{ width: size, height: size, borderRadius: size / 4, fontSize: size * 0.48 }}
    >
      A
    </div>
  )
}
