import { PageBody, PageHeader } from "@/components/common/page-header";
import { LeadsTable } from "@/components/leads/leads-table";
import { Button } from "@/components/ui/button";
import { mockLeads } from "@/lib/mock-data";
import { Kanban, Download, Upload, Bookmark } from "lucide-react";
import Link from "next/link";

export default function LeadsPage() {
  return (
    <>
      <PageHeader
        title="Leads"
        description="Every engagement we're working across all channels."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Bookmark className="h-3.5 w-3.5" /> Saved views
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/pipeline">
                  <Kanban className="h-3.5 w-3.5" /> Kanban
                </Link>
              }
            />
            <Button variant="outline" size="sm">
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </>
        }
      />
      <PageBody>
        <LeadsTable leads={mockLeads} />
      </PageBody>
    </>
  );
}
