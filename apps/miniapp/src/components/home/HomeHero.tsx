"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { usePreferences } from "../PreferencesProvider";
import { Icon } from "../ui/Icon";

// Pass an original campaign image here when it is supplied. No reference screenshots are used.
export function HomeHero({ imageSrc }: { imageSrc?: string }) {
  const { t } = usePreferences();
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(imageSrc) && !failed;
  return (
    <section
      className="home-hero"
      data-has-image={hasImage}
      aria-labelledby="home-hero-title"
    >
      {hasImage && imageSrc ? (
        <Image
          src={imageSrc}
          alt={t("home.heroAlt")}
          fill
          priority
          unoptimized
          sizes="(max-width: 480px) 90vw, 420px"
          className="home-hero__image"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="home-hero__placeholder"
          role="img"
          aria-label={t("home.heroMedia")}
        >
          <div className="home-hero__media-label">
            <Icon name="image" />
            <span>{t("home.heroMedia")}</span>
          </div>
          <span className="home-hero__watermark" aria-hidden="true">
            STENZO
            <br />
            WEAR
          </span>
          <span className="home-hero__frame" aria-hidden="true" />
        </div>
      )}
      <div className="home-hero__content">
        <p className="home-hero__eyebrow">{t("home.heroEyebrow")}</p>
        <h1 id="home-hero-title" className="home-hero__title">
          {t("home.heroTitle")}
          <span>{t("home.heroAccent")}</span>
        </h1>
        <p className="home-hero__copy">{t("home.heroCopy")}</p>
        <Link
          href="/catalog"
          className="ui-button ui-button--primary home-hero__cta"
        >
          {t("home.heroCta")}
          <Icon name="arrow" />
        </Link>
      </div>
    </section>
  );
}
