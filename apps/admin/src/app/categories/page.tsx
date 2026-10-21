import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { Categories } from "../../components/Categories";
export default async function CategoriesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Categories csrfToken={session.csrfToken} />;
}
