import { redirect } from "next/navigation";

export default async function AdminCampaignDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/outreach/${id}`);
}
