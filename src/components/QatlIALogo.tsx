'use client';

export function QatlIALogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 28, md: 36, lg: 48 };
  const s = dims[size];
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-label="QatlIA"
    >
      {/* Outer ring */}
      <circle cx="24" cy="24" r="22" fill="url(#qg)" stroke="currentColor" strokeWidth="1.5" className="text-brand-400/60" />
      {/* Inner ring */}
      <circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" strokeWidth="1" className="text-brand-400/40" />
      {/* Compass / saw blade teeth */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 24 + 16 * Math.cos(rad);
        const y1 = 24 + 16 * Math.sin(rad);
        const x2 = 24 + 20 * Math.cos(rad);
        const y2 = 24 + 20 * Math.sin(rad);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="2" className="text-brand-400" />;
      })}
      {/* Q letter (stylized) */}
      <text x="24" y="29" textAnchor="middle" fill="currentColor" fontSize="20" fontWeight="900" fontFamily="system-ui, sans-serif" letterSpacing="-0.5" className="text-brand-500">Q</text>

      <defs>
        <radialGradient id="qg" cx="8" cy="8" r="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.15" className="text-brand-400" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" className="text-brand-400" />
        </radialGradient>
      </defs>
    </svg>
  );
}