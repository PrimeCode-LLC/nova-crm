"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building, Users2, Pencil } from "lucide-react";
import { toast } from "sonner";

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

export function DepartmentDetailView({ departmentId }: { departmentId: string }) {
  const router = useRouter();
  const ws = useWorkspace();
  const dept = ws.departments.find((d) => d.id === departmentId);

  const members = React.useMemo(
    () => ws.users.filter((u) => u.departmentId === departmentId),
    [ws.users, departmentId],
  );

  const deptLeads = React.useMemo(() => {
    const ownerIds = new Set(members.map((u) => u.id));
    return ws.leads.filter((l) => ownerIds.has(l.ownerId));
  }, [ws.leads, members]);

  if (!dept) {
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">Department not found.</p>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/admin/departments">Back to departments</Link>}
        />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

  const parent = dept.parentId ? ws.departments.find((d) => d.id === dept.parentId) : undefined;
  const childDepartments = ws.departments.filter((d) => d.parentId === departmentId);

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
                <Link href="/admin/departments" aria-label="Back to departments">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
              <Building className="h-4 w-4" />
            </div>
            <div>
              <div>{dept.name}</div>
              {dept.description && (
                <p className="text-xs text-muted-foreground font-normal mt-0.5 max-w-xl">
                  {dept.description}
                </p>
              )}
            </div>
          </div>
        }
        description={
          parent ? (
            <span className="text-sm text-muted-foreground">
              Sub-department of{" "}
              <button
                type="button"
                className="text-primary hover:underline font-medium"
                onClick={() => router.push(`/admin/departments/${parent.id}`)}
              >
                {parent.name}
              </button>
            </span>
          ) : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() =>
              toast.info("Department editing will use your workspace API when connected.")
            }
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        }
      />

      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users2 className="h-4 w-4 text-muted-foreground" />
                Members ({members.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground">No users assigned to this department.</p>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Department lead</CardTitle>
            </CardHeader>
            <CardContent>
              {dept.leadUserId ? (
                <UserChip userId={dept.leadUserId} size="sm" />
              ) : (
                <p className="text-xs text-muted-foreground">No lead assigned.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {childDepartments.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sub-departments ({childDepartments.length})</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {childDepartments.map((c) => (
                <Button
                  key={c.id}
                  variant="outline"
                  size="sm"
                  className="h-8"
                  type="button"
                  onClick={() => router.push(`/admin/departments/${c.id}`)}
                >
                  {c.name}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Leads owned by this department ({deptLeads.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {deptLeads.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">No leads from members in this department.</p>
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
                  {deptLeads.map((lead) => (
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
