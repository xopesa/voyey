import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { ProductEditor } from "../../../components/products/ProductEditor";
export default async function NewProductPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <ProductEditor csrfToken={session.csrfToken} />;
}
