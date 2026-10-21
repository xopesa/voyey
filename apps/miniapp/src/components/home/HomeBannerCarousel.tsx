"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type { PublicBanner } from "@stenzo/shared";
import { getHomeBanners } from "../../lib/api-client";
import { usePreferences } from "../PreferencesProvider";
import { useCatalogResource } from "./useCatalogResource";
import { HomeHero } from "./HomeHero";
import "../../styles/banners.css";

export function HomeBannerCarousel() {
  const { state } = useCatalogResource(getHomeBanners);
  return state.status === "success" && state.data.length > 0 ? (
    <BannerCarousel banners={state.data} />
  ) : (
    <HomeHero />
  );
}
export function BannerCarousel({ banners }: { banners: PublicBanner[] }) {
  const { t, localizedText } = usePreferences();
  const [active, setActive] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  if (!banners.length) return <HomeHero />;
  return (
    <section
      className="home-banners"
      aria-label={t("home.banners")}
      aria-roledescription={t("home.carousel")}
    >
      <h1 className="visually-hidden">
        {localizedText({ ru: banners[0]!.titleRu, uz: banners[0]!.titleUz })}
      </h1>
      <div
        className="home-banners__rail"
        ref={rail}
        onScroll={() => {
          const el = rail.current;
          if (!el) return;
          const left = el.getBoundingClientRect().left;
          let closest = 0,
            distance = Infinity;
          [...el.children].forEach((child, index) => {
            const gap = Math.abs(child.getBoundingClientRect().left - left);
            if (gap < distance) {
              distance = gap;
              closest = index;
            }
          });
          setActive(closest);
        }}
      >
        {banners.map((banner, index) => {
          const title = localizedText({
            ru: banner.titleRu,
            uz: banner.titleUz,
          });
          const subtitle = localizedText({
            ru: banner.subtitleRu ?? "",
            uz: banner.subtitleUz ?? "",
          });
          const cta = localizedText({
            ru: banner.buttonRu ?? "",
            uz: banner.buttonUz ?? "",
          });
          const content = (
            <>
              <img
                src={banner.imageUrl}
                alt=""
                className="home-banners__image"
                loading={index === 0 ? "eager" : "lazy"}
              />
              <div className="home-banners__content">
                <h2>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
                {banner.href && cta && (
                  <span className="home-banners__cta">
                    {cta} <span aria-hidden="true">→</span>
                  </span>
                )}
              </div>
            </>
          );
          const href = banner.href;
          return (
            <article
              className="home-banners__slide"
              key={banner.id}
              aria-label={`${index + 1} / ${banners.length}`}
            >
              {href?.startsWith("/") && !href.startsWith("//") ? (
                <Link
                  href={href}
                  className="home-banners__link"
                  aria-label={title}
                >
                  {content}
                </Link>
              ) : href?.startsWith("https://") ? (
                <a
                  href={href}
                  className="home-banners__link"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={title}
                >
                  {content}
                </a>
              ) : (
                <div className="home-banners__link">{content}</div>
              )}
            </article>
          );
        })}
      </div>
      {banners.length > 1 && (
        <div
          className="home-banners__dots"
          aria-label={t("home.bannerNavigation")}
        >
          {banners.map((b, index) => (
            <button
              type="button"
              key={b.id}
              aria-label={`${t("home.bannerSlide")} ${index + 1}`}
              aria-pressed={active === index}
              onClick={() => {
                const reduce = window.matchMedia(
                  "(prefers-reduced-motion: reduce)",
                ).matches;
                rail.current?.children[index]?.scrollIntoView({
                  behavior: reduce ? "auto" : "smooth",
                  block: "nearest",
                  inline: "start",
                });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
