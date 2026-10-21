import { ProductDetail } from "../../../components/product/ProductDetail";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProductDetail key={slug} slug={slug} />;
}
