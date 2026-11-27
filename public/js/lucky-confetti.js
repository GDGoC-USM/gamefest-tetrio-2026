// Visual-only winner celebration. Kept separate from the draw module so its
// reduced-motion guard and cleanup can be exercised directly.
export const CONFETTI_LIFETIME_MS = 4000;
export const CONFETTI_PARTICLE_COUNT = 45;

const COLORS = [
  "#8a4bd8",
  "#d94c70",
  "#a66be8",
  "#ffcc70",
  "#ffffff",
  "#c6a1ff"
];

export function launchConfetti({
  document: doc = document,
  window: win = window,
  random = Math.random
} = {}) {
  // Respect reduced-motion accessibility settings. The CSS media query also
  // hides the layer, so the effect never appears for these users.
  if (win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    return null;
  }

  // A previous burst is normally gone before the next spin, but quickly
  // repeated spins/undos must not stack layers.
  doc.querySelectorAll(".ld-confetti").forEach(node => node.remove());

  const confetti = doc.createElement("div");
  confetti.className = "ld-confetti";

  for (let index = 0; index < CONFETTI_PARTICLE_COUNT; index++) {
    const particle = doc.createElement("span");

    particle.className = "ld-confetti-piece";

    particle.style.setProperty("--x", `${random() * 100}%`);
    particle.style.setProperty("--drift", `${random() * 300 - 150}px`);
    particle.style.setProperty("--rotation", `${random() * 1080}deg`);
    particle.style.setProperty("--duration", `${2.2 + random() * 1.2}s`);
    particle.style.setProperty("--delay", `${random() * 0.5}s`);
    particle.style.setProperty(
      "--color",
      COLORS[Math.floor(random() * COLORS.length)]
    );

    confetti.appendChild(particle);
  }

  doc.body.appendChild(confetti);

  // Longest animation is 3.4s + 0.5s delay; remove after 4s.
  win.setTimeout(() => confetti.remove(), CONFETTI_LIFETIME_MS);

  return confetti;
}
