export function KaliDragon({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id="kali-dragon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#367bf0" />
          <stop offset="55%" stopColor="#5b6ef5" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {/* stylized angular dragon head — original artwork, kali-inspired */}
      <path
        fill="url(#kali-dragon-grad)"
        d="M58 6 L42 14 L30 12 L36 19 L18 20 L27 26 L8 30 L24 35 L14 44 L28 41 L26 54 L38 44 L44 50 L46 39 L58 33 L47 29 L56 18 L44 21 Z"
      />
      <path
        fill="#0a0c10"
        d="M38 24 L46 22 L43 28 L37 27 Z"
      />
    </svg>
  );
}

export function KaliWordmark() {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <KaliDragon size={26} />
      <div className="leading-none">
        <div className="text-[15px] font-bold tracking-widest text-slate-100">
          KALI <span className="kali-gradient-text">AI PENTEST</span>
        </div>
        <div className="text-[9px] tracking-[0.3em] text-slate-500 mt-0.5">2026.3 · OFFENSIVE SUITE</div>
      </div>
    </div>
  );
}
