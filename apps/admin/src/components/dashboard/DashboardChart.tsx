"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  chartGeometry,
  dashboardDate,
  type AdminDashboard,
} from "../../lib/dashboard";
import { uzs } from "../../lib/orders";
import { dashboardCopy } from "../../lib/i18n";

export function DashboardChart({ chart }: { chart: AdminDashboard["chart"] }) {
  const t = dashboardCopy,
    locale = "ru";
  const [metric, setMetric] = useState<"orders" | "receivedPayments">("orders");
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(720);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const g = chartGeometry(chart, metric, width);
  const index = Math.min(selected ?? chart.length - 1, chart.length - 1);
  const active = g.points[index];
  const format = (value: number) =>
    `${uzs(value, locale)}${metric === "receivedPayments" ? " UZS" : ""}`;
  const ticks = width < 500 ? 2 : 5;
  const dateIndices = [
    ...new Set(
      Array.from({ length: Math.min(ticks, chart.length) }, (_, i) =>
        Math.round(
          (i / (Math.min(ticks, chart.length) - 1 || 1)) * (chart.length - 1),
        ),
      ),
    ),
  ];
  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    setSelected(
      Math.max(
        0,
        Math.min(
          chart.length - 1,
          Math.round(((x - g.left) / (g.right - g.left)) * (chart.length - 1)),
        ),
      ),
    );
  }
  return (
    <section
      className="dashboard-panel dashboard-chart"
      aria-labelledby="dashboard-chart-title"
    >
      <div className="dashboard-section-heading">
        <div>
          <h2 id="dashboard-chart-title">{t("dashboardActivity")}</h2>
          <p className="muted">{t("dashboardChartHint")}</p>
        </div>
        <div className="dashboard-segments" aria-label={t("dashboardMetric")}>
          <button
            type="button"
            aria-pressed={metric === "orders"}
            onClick={() => setMetric("orders")}
          >
            {t("orders")}
          </button>
          <button
            type="button"
            aria-pressed={metric === "receivedPayments"}
            onClick={() => setMetric("receivedPayments")}
          >
            {t("dashboardPayments")}
          </button>
        </div>
      </div>
      <div className="dashboard-chart-value" aria-live="polite">
        {active && (
          <>
            <time dateTime={active.date}>
              {dashboardDate(active.date, locale)}
            </time>
            <strong>{format(active.value)}</strong>
            <span className="dashboard-chart-secondary">
              {t(metric === "orders" ? "dashboardPayments" : "orders")}:{" "}
              {uzs(
                metric === "orders" ? active.receivedPayments : active.orders,
                locale,
              )}
              {metric === "orders" ? " UZS" : ""}
            </span>
          </>
        )}
      </div>
      <div ref={container}>
        <svg
          viewBox={`0 0 ${width} 260`}
          role="img"
          tabIndex={0}
          aria-label={`${t(metric === "orders" ? "orders" : "dashboardPayments")}. ${t("dashboardChartKeyboard")}`}
          onPointerMove={point}
          onPointerDown={point}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setSelected(null);
          }}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              setSelected(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? chart.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          chart.length - 1,
                          index + (event.key === "ArrowLeft" ? -1 : 1),
                        ),
                      ),
              );
            }
          }}
        >
          <defs>
            <linearGradient
              id="dashboard-area-fill"
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor="var(--dashboard-green)"
                stopOpacity="0.3"
              />
              <stop
                offset="100%"
                stopColor="var(--dashboard-green)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>
          <title>
            {t(metric === "orders" ? "orders" : "dashboardPayments")}
          </title>
          {[0, 1, 2, 3, 4].map((tick) => {
            const y = g.bottom - (tick / 4) * (g.bottom - g.top);
            const value = (g.ceiling * tick) / 4;
            return (
              <g key={tick}>
                <line
                  x1={g.left}
                  x2={g.right}
                  y1={y}
                  y2={y}
                  className="dashboard-grid-line"
                />
                <text x={g.left - 10} y={y + 4} textAnchor="end">
                  {new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(value)}
                </text>
              </g>
            );
          })}
          {g.points.length > 1 && (
            <path
              d={`${g.path} L${g.right},${g.bottom} L${g.left},${g.bottom} Z`}
              className="dashboard-chart-area"
            />
          )}
          <path d={g.path} className="dashboard-chart-line" />
          {g.points.map((p) => (
            <circle
              key={p.date}
              cx={p.x}
              cy={p.y}
              r={chart.length > 40 ? 1.5 : 3}
              className="dashboard-chart-point"
            />
          ))}
          {active && (
            <>
              <line
                x1={active.x}
                x2={active.x}
                y1={g.top}
                y2={g.bottom}
                className="dashboard-chart-guide"
              />
              <circle
                cx={active.x}
                cy={active.y}
                r={5}
                className="dashboard-chart-selected"
              />
            </>
          )}
          {dateIndices.map((i) => (
            <text
              key={i}
              x={g.points[i]!.x}
              y={249}
              textAnchor={
                i === 0 ? "start" : i === chart.length - 1 ? "end" : "middle"
              }
            >
              {dashboardDate(chart[i]!.date, locale)}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}
