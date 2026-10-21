"use client";
import { effectiveProductPrice } from "@stenzo/shared";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  formatProductPrice,
  productImageSource,
  productIsAvailable,
  type CatalogProduct,
} from "../../lib/catalog";
import { usePreferences } from "../PreferencesProvider";
import { Icon } from "../ui/Icon";
import {
  productHref,
  rememberProductReturn,
} from "../../lib/product-navigation";

function ProductMedia({
  src,
  name,
  available,
}: {
  src?: string;
  name: string;
  available: boolean;
}) {
  const { t } = usePreferences();
  const [failed, setFailed] = useState(false);
  return (
    <div className="product-card__media">
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          fill
          unoptimized
          sizes="(max-width: 480px) 43vw, 200px"
          className="product-card__image"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="product-card__placeholder"
          role="img"
          aria-label={t("home.productNoImage")}
        >
          <Icon name="image" />
          <span>{t("home.productNoImage")}</span>
        </div>
      )}
      {!available && (
        <span className="product-card__stock">{t("catalog.unavailable")}</span>
      )}
    </div>
  );
}

export function ProductCard({
  product,
  from = "/catalog",
  onOpen,
}: {
  product: CatalogProduct;
  from?: string;
  onOpen?: () => void;
}) {
  const { locale, localizedText } = usePreferences();
  const name = localizedText({ ru: product.nameRu, uz: product.nameUz });
  const src = productImageSource(product);
  const available = productIsAvailable(product);
  const content = (
    <>
      <ProductMedia
        key={src ?? "no-image"}
        src={src}
        name={name}
        available={available}
      />
      <div className="product-card__details">
        <p className="product-card__category">
          {localizedText({
            ru: product.category.nameRu,
            uz: product.category.nameUz,
          })}
        </p>
        <h3 className="product-card__name">{name}</h3>
        <p className="product-card__price">
          {effectiveProductPrice(product).isOnSale && (
            <del className="sale-original">
              {formatProductPrice(product.price, locale)}
            </del>
          )}
          {formatProductPrice(
            effectiveProductPrice(product).effectivePrice,
            locale,
          )}
        </p>
      </div>
    </>
  );
  return (
    <article className="product-card" data-unavailable={!available}>
      <Link
        className="product-card__link"
        href={productHref(product.slug, from)}
        onClick={(event) => {
          if (
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            rememberProductReturn(product.slug, from);
            onOpen?.();
          }
        }}
      >
        {content}
      </Link>
    </article>
  );
}
