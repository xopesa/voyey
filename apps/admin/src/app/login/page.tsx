import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { Login } from "../../components/Login";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return <Login />;
}
