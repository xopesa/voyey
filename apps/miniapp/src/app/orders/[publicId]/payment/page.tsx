import { PaymentPageContent } from "../../../../components/payment/PaymentPageContent";
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <PaymentPageContent publicId={publicId} />;
}
