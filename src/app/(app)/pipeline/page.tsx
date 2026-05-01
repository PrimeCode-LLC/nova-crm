import { PageBody, PageHeader } from "@/components/common/page-header";
import { KanbanBoard } from "@/components/leads/kanban-board";
import { Button } from "@/components/ui/button";
import { mockLeads } from "@/lib/mock-data";
import { Plus, Table as TableIcon, Filter } from "lucide-react";
import Link from "next/link";

export default function PipelinePage() {
  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Drag leads between stages. Stage-required fields validate on drop."
        actions={
          <>
            <Button variant="outline" size="sm"><Filter className="h-3.5 w-3.5" /> Filter</Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/leads">
                  <TableIcon className="h-3.5 w-3.5" /> Table
                </Link>
              }
            />
            <Button size="sm"><Plus className="h-3.5 w-3.5" /> New lead</Button>
          </>
        }
      />
      <PageBody>
        <KanbanBoard leads={mockLeads} />
      </PageBody>
    </>
  );
}
