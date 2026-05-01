import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StageBadge } from "@/components/common/stage-badge";
import { UserChip } from "@/components/common/user-chip";
import { Badge } from "@/components/ui/badge";
import { mockDeals, getAccountById, getContactById, getLeadById } from "@/lib/mock-data";
import { fmtCurrency, fmtDate, fmtRelative } from "@/lib/format";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = mockDeals.find((d) => d.id === id);
  if (!deal) notFound();
  const account = getAccountById(deal.accountId);
  const contact = getContactById(deal.contactId);
  const lead = getLeadById(deal.leadId);

  return (
    <>
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <Link href="/deals" aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <div>
              <div className="flex items-center gap-2">
                <span>{deal.name}</span>
                <StageBadge stage={deal.stage} />
              </div>
              <div className="text-xs text-muted-foreground font-normal mt-0.5">
                {account?.name} · {contact?.fullName}
              </div>
            </div>
          </div>
        }
        actions={<Button variant="outline" size="sm">Edit</Button>}
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Value</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-3xl font-semibold tabular-nums">{fmtCurrency(deal.value, deal.currency)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Weighted: <span className="tabular-nums">{fmtCurrency((deal.value * deal.probability) / 100, deal.currency)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Probability</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="text-3xl font-semibold tabular-nums">{deal.probability}%</div>
              <Progress value={deal.probability} className="h-1.5" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Close date</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-xl font-semibold">{fmtDate(deal.expectedCloseDate, "MMM d, yyyy")}</div>
              <div className="text-xs text-muted-foreground mt-1">{fmtRelative(deal.expectedCloseDate)}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Products</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-2">
              {deal.products?.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              )) ?? <span className="text-sm text-muted-foreground">None</span>}
            </CardContent>
          </Card>

          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Owner</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <UserChip userId={deal.ownerId} size="md" />
              </CardContent>
            </Card>
            {lead && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Source lead</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <Link href={`/leads/${lead.id}`} className="text-sm hover:text-primary">
                    {lead.contactName} · {lead.companyName}
                  </Link>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </PageBody>
    </>
  );
}
