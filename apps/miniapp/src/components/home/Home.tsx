import { Page } from "../ui/foundation";
import { HomeCategories } from "./HomeCategories";
import { HomeBannerCarousel } from "./HomeBannerCarousel";
import { HomeProducts } from "./HomeProducts";

export function Home() {
  return (
    <Page className="home">
      <HomeBannerCarousel />
      <HomeCategories />
      <HomeProducts />
    </Page>
  );
}
