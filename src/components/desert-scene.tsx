export function DesertScene() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg viewBox="0 0 1000 400" preserveAspectRatio="xMidYMax slice" className="absolute bottom-0 left-0 h-[62%] w-full">
        <rect x="0" y="370" width="1000" height="6" className="fill-primary opacity-[0.12]" />

        <path
          d="M 900 40 a 32 32 0 1 0 0 64 a 24 24 0 1 1 0 -64 Z"
          className="fill-accent-beige opacity-[0.16]"
        />

        <g className="fill-accent-beige opacity-[0.16]">
          <ellipse cx="120" cy="60" rx="22" ry="8" />
          <ellipse cx="140" cy="55" rx="16" ry="7" />
          <ellipse cx="780" cy="90" rx="18" ry="7" />
          <ellipse cx="798" cy="85" rx="12" ry="6" />
        </g>

        <g className="fill-accent-beige opacity-[0.16]">
          <rect x="640" y="330" width="220" height="40" />
          <path d="M700 330 a20 20 0 0 1 40 0 Z" />
          <rect x="716" y="300" width="8" height="30" />
          <circle cx="720" cy="298" r="5" />
          <path d="M790 330 a14 14 0 0 1 28 0 Z" />
          <path d="M840 330 a10 10 0 0 1 20 0 Z" />
        </g>

        <defs>
          <symbol id="datepalm-scene" viewBox="0 0 100 140">
            <path d="M47 140 C46 110 47 80 49 62 L53 62 C55 80 55 110 55 140 Z" />
            <path d="M51 60 C51 60 30 46 10 46 C10 46 26 62 48 66 Z" />
            <path d="M51 60 C51 60 72 46 92 46 C92 46 76 62 54 66 Z" />
            <path d="M51 58 C51 58 24 34 6 20 C6 20 26 30 46 52 Z" />
            <path d="M51 58 C51 58 78 34 96 20 C96 20 76 30 56 52 Z" />
            <path d="M51 56 C51 56 30 22 22 2 C22 2 38 16 48 46 Z" />
            <path d="M51 56 C51 56 72 22 80 2 C80 2 64 16 54 46 Z" />
            <path d="M51 54 C51 54 44 18 46 0 C46 0 54 4 52 44 Z" />
            <path d="M51 54 C51 54 58 18 56 0 C56 0 48 4 50 44 Z" />
          </symbol>
        </defs>

        <use href="#datepalm-scene" x="260" y="130" width="130" height="240" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="380" y="180" width="90" height="190" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="470" y="210" width="70" height="160" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="560" y="230" width="60" height="140" className="fill-primary opacity-[0.12]" />
        <use href="#datepalm-scene" x="630" y="240" width="55" height="130" className="fill-primary opacity-[0.12]" />

        <g className="fill-primary opacity-[0.12]" transform="translate(20,150) scale(1.7)">
          <path d="M18 100 C18 92 24 86 30 86 C32 78 40 66 52 62 C50 54 54 44 62 40 C58 32 62 22 72 20 C80 18 88 24 90 32 C96 26 106 26 112 32 C118 26 128 28 132 36 C140 34 148 40 148 48 C156 48 162 56 160 64 C168 66 172 74 168 82 C176 84 180 92 176 100 L176 106 L166 106 L164 96 C160 98 150 98 146 96 L144 106 L134 106 L132 92 C124 96 112 96 104 92 C98 96 88 98 80 94 L78 106 L68 106 L66 94 C58 96 48 94 42 88 L40 106 L28 106 L26 96 C20 96 16 92 18 100 Z M100 36 C96 30 96 22 102 18 C108 14 116 18 118 24 C122 20 128 22 128 28 C128 34 122 36 118 34" />
        </g>
      </svg>
    </div>
  );
}
