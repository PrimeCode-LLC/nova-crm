import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { ProspectDraftsList } from "@/components/prospects/prospect-drafts-list";
import { Button } from "@/components/ui/button";

export default function ProspectDraftsPage() {
  return (
    <AppPage>
      <PageHeader
        title="Prospect drafts"
        description="Resume research, finish ready prospects, or manage saved prospect work."
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href="/prospects">
                <ArrowLeft className="size-3.5" /> Prospects
              </Link>
            }
          />
        }
      />
      <PageBody>
        <ProspectDraftsList />
      </PageBody>
    </AppPage>
  );
}
