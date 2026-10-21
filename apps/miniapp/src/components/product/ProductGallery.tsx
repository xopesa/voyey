"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { CatalogProduct } from "../../lib/catalog";
import { galleryImages, swipeDirection } from "../../lib/product";
import { usePreferences } from "../PreferencesProvider";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/foundation";

function Photo({
  src,
  alt,
  thumbnail = false,
}: {
  src?: string;
  alt: string;
  thumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const { t } = usePreferences();
  return src && !failed ? (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={thumbnail ? "64px" : "(max-width: 480px) 90vw, 420px"}
      onError={() => setFailed(true)}
      draggable={false}
    />
  ) : (
    <span
      className="product-gallery__placeholder"
      role="img"
      aria-label={t("home.productNoImage")}
    >
      <Icon name="image" />
      {!thumbnail && <span>{t("home.productNoImage")}</span>}
    </span>
  );
}

export function ProductGallery({
  product,
  name,
}: {
  product: CatalogProduct;
  name: string;
}) {
  const { t } = usePreferences();
  const images = galleryImages(product);
  const [index, setIndex] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const thumbnails = useRef<HTMLDivElement>(null);
  useEffect(() => {
    thumbnails.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
  }, [index]);
  const choose = (next: number) =>
    setIndex(Math.max(0, Math.min(images.length - 1, next)));
  return (
    <section className="product-gallery" aria-label={t("product.gallery")}>
      <div
        className="product-gallery__main"
        tabIndex={images.length > 1 ? 0 : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            choose(index + (event.key === "ArrowRight" ? 1 : -1));
          }
        }}
        onPointerDown={(event) => {
          if (event.isPrimary && event.button === 0)
            start.current = {
              x: event.clientX,
              y: event.clientY,
              id: event.pointerId,
            };
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
        onPointerUp={(event) => {
          const origin = start.current;
          start.current = null;
          if (origin?.id === event.pointerId)
            choose(
              index +
                swipeDirection(
                  event.clientX - origin.x,
                  event.clientY - origin.y,
                ),
            );
        }}
      >
        <Photo
          key={images[index]?.url ?? "empty"}
          src={images[index]?.url}
          alt={name}
        />
        {images.length > 1 && (
          <>
            <span className="product-gallery__count" aria-live="polite">
              {index + 1} / {images.length}
            </span>
            <div className="product-gallery__controls">
              <IconButton
                label={t("product.previousPhoto")}
                disabled={index === 0}
                onClick={() => choose(index - 1)}
                className="product-back"
              >
                <Icon name="arrow" />
              </IconButton>
              <IconButton
                label={t("product.nextPhoto")}
                disabled={index === images.length - 1}
                onClick={() => choose(index + 1)}
              >
                <Icon name="arrow" />
              </IconButton>
            </div>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="product-gallery__thumbnails" ref={thumbnails}>
          {images.map((image, number) => (
            <button
              key={image.id}
              type="button"
              aria-pressed={number === index}
              aria-label={t("product.photo", {
                index: number + 1,
                count: images.length,
              })}
              onClick={() => choose(number)}
            >
              <Photo key={image.url} src={image.url} alt="" thumbnail />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
