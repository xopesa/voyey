import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { ProductsList } from "../../components/products/ProductsList";
export default async function ProductsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <ProductsList csrfToken={session.csrfToken} />;
}
