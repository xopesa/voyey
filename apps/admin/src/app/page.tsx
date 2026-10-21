import { redirect } from "next/navigation";
import { getSession } from "../lib/session";
import { Dashboard } from "../components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <Dashboard csrfToken={session.csrfToken} />;
}
