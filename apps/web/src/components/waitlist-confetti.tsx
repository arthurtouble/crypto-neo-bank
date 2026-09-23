"use client";

const pieces = Array.from({ length: 32 }, (_, index) => index);

export function WaitlistConfetti({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="waitlistConfetti" data-testid="waitlist-confetti" aria-hidden="true">
    {pieces.map((piece) => <i key={piece} style={{
      left: `${(piece * 37 + 11) % 100}%`,
      top: `${(piece * 23 + 7) % 78}%`,
      animationDelay: `${(piece % 8) * 55}ms`,
      backgroundColor: ["#56745b", "#d7b77f", "#e8e7df", "#8d9e8a"][piece % 4]
    }} />)}
  </div>;
}
