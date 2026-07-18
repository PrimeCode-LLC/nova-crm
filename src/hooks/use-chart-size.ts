"use client";

import * as React from "react";

/** Measure a chart parent without ResponsiveContainer (avoids ResizeObserver thrash). */
export function useChartSize(defaultSize = { w: 320, h: 200 }) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = React.useState(defaultSize);

  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const commit = (w: number, h: number) => {
      const nw = Math.max(1, Math.floor(w));
      const nh = Math.max(1, Math.floor(h));
      setChartSize((d) => (d.w === nw && d.h === nh ? d : { w: nw, h: nh }));
    };
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        commit(cr.width, cr.height);
      });
    });
    ro.observe(el);
    commit(el.clientWidth, el.clientHeight);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return { wrapRef, chartSize };
}
