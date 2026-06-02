import { redirect } from "next/navigation";

type SearchParams = { user?: string; person?: string };

export default async function UsersAdminRedirect({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const id = sp.person ?? sp.user;
  if (id) {
    redirect(`/admin/people?person=${encodeURIComponent(id)}`);
  }
  redirect("/admin/people");
}
