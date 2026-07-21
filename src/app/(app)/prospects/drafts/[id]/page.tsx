import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { ProspectDraftEditor } from "@/components/prospects/prospect-draft-editor";
import { Button } from "@/components/ui/button";

export default async function ProspectDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppPage>
      <PageHeader
        title="Complete prospect draft"
        description="Review Nova AI suggestions, resolve conflicts, and complete the prospect when the facts are ready."
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href="/prospects">
                <ArrowLeft className="h-3.5 w-3.5" /> Prospects
              </Link>
            }
          />
        }
      />
      <PageBody contained>
        <ProspectDraftEditor draftId={id} />
      </PageBody>
    </AppPage>
  );
}
