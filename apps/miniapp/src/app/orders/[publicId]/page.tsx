import { OrderDetailContent } from "../../../components/orders/OrderDetailContent";
export default async function OrderPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <OrderDetailContent publicId={publicId} />;
}
