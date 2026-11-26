"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { mountPhone, type PhoneApi, type ScenarioKey } from "./phone/phone";

declare global {
  interface Window {
    /** Set by the inline script after the first screen (app/page.tsx), so the phone has its size before the first paint. */
    __rungFitPhone?: () => void;
  }
}

const ORDER: ScenarioKey[] = ["app", "climb", "nobuy"];
const POSTER = "/site/seeker-poster.webp";

// The Solana bars: place, width, height, opacity, drift period and phase, and the delay of the entrance from the left
// (they appear one by one while the Seeker comes in).
const BARS = [
  { x: "-6%", y: "6%", w: "150px", o: 0.34, d: "15s", in: "1.4s" },
  { x: "4%", y: "24%", w: "96px", h: "12px", o: 0.22, d: "19s", delay: "-6s", in: "1.9s" },
  { x: "-10%", y: "47%", w: "178px", o: 0.3, d: "17s", delay: "-3s", in: "2.4s" },
  { x: "2%", y: "71%", w: "120px", h: "14px", o: 0.24, d: "21s", delay: "-9s", in: "2.9s" },
  { x: "70%", y: "12%", w: "132px", h: "14px", o: 0.26, d: "18s", delay: "-4s", in: "3.6s" },
  { x: "76%", y: "36%", w: "168px", o: 0.34, d: "16s", delay: "-11s", in: "4.2s" },
  { x: "68%", y: "58%", w: "104px", h: "12px", o: 0.22, d: "22s", delay: "-7s", in: "4.8s" },
  { x: "74%", y: "80%", w: "150px", o: 0.3, d: "17s", delay: "-2s", in: "5.4s" },
];

function barStyle(b: (typeof BARS)[number]): CSSProperties {
  const s: Record<string, string | number> = { "--x": b.x, "--y": b.y, "--w": b.w, "--o": b.o, "--d": b.d, "--in": b.in };
  if ("h" in b && b.h) s["--h"] = b.h;
  if ("delay" in b && b.delay) s["--delay"] = b.delay;
  return s as CSSProperties;
}

// The phone keeps a real phone's proportions in every window: when the height is short, the whole phone scales down
// together (--pz). The measure is the Buy button: 777 px below the top of the frame at design size (the frame is
// 818 px), so the button stays on the first screen and the bottom of the frame may run a little past the fold; on a
// laptop the phone is larger that way (Buğra, Nov 26). On phone screens (600 px and below) the app fills the screen
// and the scale stays 1. The same function runs inline before the first paint (FIT_PHONE in app/page.tsx).
function fitPhone(): void {
  let s = 1;
  if (!window.matchMedia("(max-width: 600px)").matches) {
    const wrap = document.querySelector<HTMLElement>(".hero .wrap");
    if (wrap) {
      const top = wrap.getBoundingClientRect().top + window.scrollY + parseFloat(getComputedStyle(wrap).paddingTop);
      s = Math.max(0.55, Math.min(1, (window.innerHeight - top - 14) / 777));
    }
  }
  document.documentElement.style.setProperty("--pz", s.toFixed(3));
}

export default function PhoneStage({
  label,
  chips,
  notes,
}: {
  label: string;
  chips: Record<ScenarioKey, string>;
  notes: Record<ScenarioKey, string>;
}) {
  const colRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<PhoneApi | null>(null);
  const [scen, setScen] = useState<ScenarioKey>("app");

  // The scale, kept up to date when the window or the top bar changes.
  useEffect(() => {
    const fit = window.__rungFitPhone ?? fitPhone;
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("load", fit);
    void document.fonts.ready.then(fit);
    const nav = document.querySelector(".nav");
    const watch = nav ? new ResizeObserver(() => fit()) : null;
    if (nav && watch) watch.observe(nav);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("load", fit);
      watch?.disconnect();
    };
  }, []);

  // The phone in front: a replay of real orders. Its bars light up when a rung is tried.
  useEffect(() => {
    const root = phoneRef.current;
    if (!root) return;
    const api = mountPhone(root);
    apiRef.current = api;
    api.on("scenario", setScen);
    let pulse: ReturnType<typeof setTimeout> | undefined;
    api.on("rung", (e) => {
      const field = fieldRef.current;
      if (!field || (e.state !== "trying" && e.state !== "filled")) return;
      field.classList.remove("pulse", "good");
      void field.offsetWidth;
      field.classList.add(e.state === "filled" ? "good" : "pulse");
      clearTimeout(pulse);
      pulse = setTimeout(() => field.classList.remove("pulse", "good"), 750);
    });
    return () => {
      clearTimeout(pulse);
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  // The Seeker behind: plays once when the first screen is in view and stays on its last frame. With "reduce motion",
  // or when the video cannot play, only the last frame (the poster) shows, without the spin.
  useEffect(() => {
    const sb = videoRef.current;
    const col = colRef.current;
    if (!sb || !col) return;
    sb.muted = true;
    const showStill = () => {
      sb.poster = POSTER;
      sb.classList.add("on");
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      showStill();
      return;
    }
    // Where the phone sets off: just outside the left edge of the screen, so at first nothing shows. Its end place is
    // the video's turning point, which the spin does not move, so it comes from the column's position. The distance
    // is divided by the column's scale (--pz) because the video scales inside that column.
    const aim = () => {
      const cs = getComputedStyle(sb);
      if (cs.display === "none") return;
      const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pz")) || 1;
      const w = parseFloat(cs.width);
      const endX = col.getBoundingClientRect().left + (parseFloat(cs.left) + w * 0.7352) * k;
      const startX = -0.16 * w * k;
      sb.style.setProperty("--sb-dx", ((startX - endX) / k).toFixed(1) + "px");
      sb.style.setProperty("--sb-dy", "40px");
    };
    const onPlaying = () => {
      aim();
      sb.classList.add("on", "spin");
    };
    sb.addEventListener("error", showStill, true);
    sb.addEventListener("playing", onPlaying, { once: true });
    const start = () => {
      sb.play().catch(showStill);
    };
    const watch = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        watch.disconnect();
        start();
      },
      { threshold: 0.2 },
    );
    watch.observe(col);
    return () => {
      watch.disconnect();
      sb.removeEventListener("error", showStill, true);
      sb.removeEventListener("playing", onPlaying);
    };
  }, []);

  return (
    <div className="phone-col" ref={colRef}>
      <div className="sol-field" ref={fieldRef} aria-hidden="true">
        {BARS.map((b) => (
          <i key={b.x + b.y} style={barStyle(b)} />
        ))}
      </div>
      <video className="seeker-back" ref={videoRef} muted playsInline preload="auto" aria-hidden="true" width={1280} height={720}>
        <source src="/site/seeker-in.mp4" type="video/mp4" />
      </video>
      <div className="device seeker" ref={phoneRef} />
      <div className="replay">
        <div className="chips" role="group" aria-label={label}>
          {ORDER.map((k) => (
            <button key={k} type="button" aria-pressed={scen === k} onClick={() => apiRef.current?.setScenario(k)}>
              {chips[k]}
            </button>
          ))}
        </div>
        <p>{notes[scen]}</p>
      </div>
    </div>
  );
}
