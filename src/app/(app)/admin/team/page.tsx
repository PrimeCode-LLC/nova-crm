import { redirect } from "next/navigation";

export default function TeamAdminRedirect() {
  redirect("/admin/people");
}
