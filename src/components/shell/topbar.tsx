export function Topbar({ title, userEmail }: { title: string; userEmail: string }) {
  return (
    <div className="relative z-10 flex items-center justify-between border-b border-border-subtle bg-white/70 px-7 py-3.5 backdrop-blur-sm">
      <div className="text-[15px] font-bold text-heading">{title}</div>
      <div className="text-[12.5px] text-muted-fg">{userEmail}</div>
    </div>
  );
}
