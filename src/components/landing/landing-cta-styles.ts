/** Classes CTA landing — cohérence hero / demo / final / tarifs. */
const primaryLook =
  "group inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent)] text-sm font-medium tracking-[-0.01em] text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent),var(--shadow-accent)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--accent-hover)] hover:shadow-[inset_0_1px_0_color-mix(in_oklab,white_22%,transparent),0_1px_2px_color-mix(in_oklab,var(--accent)_30%,transparent),0_12px_28px_-8px_color-mix(in_oklab,var(--accent)_60%,transparent)] active:scale-[0.98]";

const secondaryLook =
  "group inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] text-sm font-medium tracking-[-0.01em] text-[var(--foreground)] shadow-[var(--highlight),var(--shadow-xs)] backdrop-blur-sm transition-[border-color,color,background-color,box-shadow,transform] duration-150 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border-strong))] hover:bg-[var(--surface)] hover:text-[var(--accent)] hover:shadow-[var(--highlight),var(--shadow-sm)] active:scale-[0.98]";

const heroSize = "h-11 px-5";
const blockSize =
  "mt-6 min-h-11 w-full shrink-0 justify-center px-3 py-2.5 text-center leading-tight";

export const landingCtaPrimary = `${primaryLook} ${heroSize}`;
export const landingCtaSecondary = `${secondaryLook} ${heroSize}`;
export const landingCtaPrimaryBlock = `${primaryLook} ${blockSize}`;
export const landingCtaSecondaryBlock = `${secondaryLook} ${blockSize}`;
