"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Users2 } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserChip } from "@/components/common/user-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";

export function TeamDetailView({ teamId }: { teamId: string }) {
  const ws = useWorkspace();
  const team = ws.departments.find((candidate) => candidate.id === teamId);

  const members = React.useMemo(
    () => ws.users.filter((u) => u.departmentId === teamId),
    [ws.users, teamId],
  );

  const teamLeads = React.useMemo(() => {
    const ownerIds = new Set(members.map((u) => u.id));
    return ws.leads.filter((l) => ownerIds.has(l.ownerId));
  }, [ws.leads, members]);

  if (!team) {
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">Team not found.</p>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/admin/teams">Back to teams</Link>}
        />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

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
                <Link href="/admin/teams" aria-label="Back to teams">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Users2 className="h-4 w-4" />
            </div>
            <div>
              <div>{team.name}</div>
              {team.description && (
                <p className="text-xs text-muted-foreground font-normal mt-0.5 max-w-xl">
                  {team.description}
                </p>
              )}
            </div>
          </div>
        }
        description="Optional reporting group. Membership does not change reporting lines or grant CRM access."
      />

      <PageBody>
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users2 className="h-4 w-4 text-muted-foreground" />
                Members ({members.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground">No people assigned to this team.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {members.map((u) => (
                    <li key={u.id}>
                      <UserChip userId={u.id} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">CRM leads owned by team members ({teamLeads.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {teamLeads.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">No leads owned by this team.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Lead</TableHead>
                    <TableHead className="text-xs">Owner</TableHead>
                    <TableHead className="text-xs text-right w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamLeads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="text-sm font-medium">{lead.companyName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <UserChip userId={lead.ownerId} size="xs" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          nativeButton={false}
                          render={<Link href={`/leads/${lead.id}`}>Open</Link>}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
