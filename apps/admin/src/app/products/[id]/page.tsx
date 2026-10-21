import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { ProductEditor } from "../../../components/products/ProductEditor";
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <ProductEditor
      csrfToken={session.csrfToken}
      productId={(await params).id}
    />
  );
}
