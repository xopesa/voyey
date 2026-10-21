import { Suspense } from "react";
import { Catalog, CatalogSkeleton } from "../../components/catalog/Catalog";
import { Page } from "../../components/ui/foundation";

export default function CatalogPage() {
  return (
    <Suspense
      fallback={
        <Page className="catalog-page">
          <CatalogSkeleton />
        </Page>
      }
    >
      <Catalog />
    </Suspense>
  );
}
