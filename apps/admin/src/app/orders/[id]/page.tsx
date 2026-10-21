import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { OrderDetail } from "../../../components/orders/OrderDetail";
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <OrderDetail
      csrfToken={session.csrfToken}
      publicId={(await params).id}
      paymentId={(await searchParams).payment}
    />
  );
}
