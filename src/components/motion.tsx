"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform, type Variants } from "framer-motion";

export const fadeUp: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: .6, ease: [.2, .8, .2, 1] } } };
export const fade: Variants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: .5 } } };
export const stagger = (delay = .08, start = .05): Variants => ({ hidden: {}, show: { transition: { staggerChildren: delay, delayChildren: start } } });
export const scaleIn: Variants = { hidden: { opacity: 0, scale: .94 }, show: { opacity: 1, scale: 1, transition: { duration: .5, ease: [.2, .8, .2, 1] } } };

/** Animates children when the block scrolls into view. */
export function Reveal({ children, className = "", delay = 0, once = true, as = "div", y = 24 }: { children: ReactNode; className?: string; delay?: number; once?: boolean; as?: "div" | "section" | "li" | "article"; y?: number }) {
  const C = motion[as];
  return <C initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once, amount: .2, margin: "0px 0px -60px 0px" }} transition={{ duration: .65, delay, ease: [.2, .8, .2, 1] }} className={className}>{children}</C>;
}

/** Stagger container for lists/grids. */
export function RevealGroup({ children, className = "", delay = .08, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "ul" | "section" }) {
  const C = motion[as];
  return <C variants={stagger(delay)} initial="hidden" whileInView="show" viewport={{ once: true, amount: .15 }} className={className}>{children}</C>;
}
export function RevealItem({ children, className = "", as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" | "article" }) {
  const C = motion[as];
  return <C variants={fadeUp} className={className}>{children}</C>;
}

/** Count-up number that starts when visible. */
export function CountUp({ to, duration = 1.4, suffix = "", prefix = "", className = "", decimals = 0 }: { to: number; duration?: number; suffix?: string; prefix?: string; className?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setV(to); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / (duration * 1000)); const e = 1 - Math.pow(1 - p, 3); setV(to * e); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduce]);
  return <span ref={ref} className={className}>{prefix}{v.toFixed(decimals)}{suffix}</span>;
}

/** Subtle 3D tilt that follows the pointer. */
export function Tilt({ children, className = "", max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-.5, .5], [max, -max]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(x, [-.5, .5], [-max, max]), { stiffness: 180, damping: 18 });
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d", perspective: 1200 }} onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - r.left) / r.width - .5); y.set((e.clientY - r.top) / r.height - .5); }} onPointerLeave={() => { x.set(0); y.set(0); }} className={className}>{children}</motion.div>
  );
}

/** Typewriter cycling through phrases. */
export function Typewriter({ phrases, className = "", speed = 46, pause = 1500 }: { phrases: string[]; className?: string; speed?: number; pause?: number }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0); const [text, setText] = useState(reduce ? phrases[0] : ""); const [del, setDel] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const full = phrases[i % phrases.length];
    const t = window.setTimeout(() => {
      if (!del) { if (text.length < full.length) setText(full.slice(0, text.length + 1)); else window.setTimeout(() => setDel(true), pause); }
      else { if (text.length) setText(full.slice(0, text.length - 1)); else { setDel(false); setI((n) => n + 1); } }
    }, del ? speed / 2 : speed);
    return () => window.clearTimeout(t);
  }, [text, del, i, phrases, speed, pause, reduce]);
  return <span className={`caret ${className}`}>{text}</span>;
}

/** Magnetic hover for primary buttons. */
export function Magnetic({ children, className = "", strength = 14 }: { children: ReactNode; className?: string; strength?: number }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18 }), sy = useSpring(y, { stiffness: 260, damping: 18 });
  if (reduce) return <span className={className}>{children}</span>;
  return <motion.span style={{ x: sx, y: sy }} onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); x.set(((e.clientX - r.left) / r.width - .5) * strength); y.set(((e.clientY - r.top) / r.height - .5) * strength); }} onPointerLeave={() => { x.set(0); y.set(0); }} className={`inline-block ${className}`}>{children}</motion.span>;
}

/** Page/view transition wrapper used inside the app shell. */
export function ViewFade({ children, k }: { children: ReactNode; k: string }) {
  return <motion.div key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .28, ease: [.2, .8, .2, 1] }}>{children}</motion.div>;
}
