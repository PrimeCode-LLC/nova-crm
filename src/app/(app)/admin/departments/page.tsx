"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserChip } from "@/components/common/user-chip";
import { mockDepartments, mockUsers, mockLeads } from "@/lib/mock-data";
import { Users2, Building, Plus } from "lucide-react";
import { toast } from "sonner";

export default function AdminDepartmentsPage() {
  const [newOpen, setNewOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [leadUserId, setLeadUserId] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleCreate() {
    if (!name) { toast.error("Name is required"); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    toast.success(`Department "${name}" created`);
    setNewOpen(false);
    setName(""); setDescription(""); setParentId(""); setLeadUserId("");
  }

  const deptStats = mockDepartments.map((d) => ({
    ...d,
    memberCount: mockUsers.filter((u) => u.departmentId === d.id).length,
    leadCount: mockLeads.filter((l) =>
      mockUsers.find((u) => u.id === l.ownerId)?.departmentId === d.id,
    ).length,
  }));

  return (
    <>
      <PageHeader
        title="Departments"
        description="Organize your team into departments for scoped reporting and permissions."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New department
          </Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {deptStats.map((d) => (
            <Card key={d.id} className="hover:bg-muted/20 transition-colors cursor-pointer">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Building className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-sm">{d.name}</CardTitle>
                  </div>
                </div>
                {d.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {d.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Users2 className="h-3.5 w-3.5" />
                    <span className="tabular-nums font-medium text-foreground">
                      {d.memberCount}
                    </span>{" "}
                    member{d.memberCount !== 1 ? "s" : ""}
                  </div>
                  <div className="text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground">
                      {d.leadCount}
                    </span>{" "}
                    lead{d.leadCount !== 1 ? "s" : ""}
                  </div>
                </div>
                {d.leadUserId && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Lead
                    </div>
                    <UserChip userId={d.leadUserId} size="xs" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building className="h-4 w-4" /> New department
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                placeholder="e.g. Outbound Sales"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                placeholder="What does this department do?"
                className="h-20 text-sm resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Parent department (optional)</Label>
              <Select value={parentId} onValueChange={(v) => setParentId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None (top-level)" />
                </SelectTrigger>
                <SelectContent>
                  {mockDepartments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lead (optional)</Label>
              <Select value={leadUserId} onValueChange={(v) => setLeadUserId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {mockUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={loading}>
              {loading ? "Creating…" : "Create department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
